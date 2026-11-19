import { useEffect, useMemo, useState } from "react";
import { BrowserProvider, Contract, JsonRpcProvider, keccak256, toUtf8Bytes } from "ethers";
import QRCode from "qrcode";

const ABI = [
  "function owner() view returns (address)",
  "function verifyCertificate(bytes32 certificateId) view returns (bool)",
  "function getCertificate(bytes32 certificateId) view returns (tuple(address recipient,address issuer,bytes32 documentHash,string ipfsCid,uint256 issuedAt,bool revoked))",
  "function issueCertificate(bytes32 certificateId,address recipient,bytes32 documentHash,string ipfsCid)",
  "function revokeCertificate(bytes32 certificateId)"
];
const RPC_URL = import.meta.env.VITE_RPC_URL || "";
const CONTRACT_ADDRESS = import.meta.env.VITE_CONTRACT_ADDRESS || "";
const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";
const CHAIN_ID = Number(import.meta.env.VITE_CHAIN_ID || 31337);
const short = (value) => value ? `${value.slice(0,8)}…${value.slice(-6)}` : "—";

async function hashFile(file) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return `0x${Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2,"0")).join("")}`;
}

export default function App() {
  const [wallet,setWallet] = useState("");
  const [contractAddress,setContractAddress] = useState(new URLSearchParams(window.location.search).get("contract") || CONTRACT_ADDRESS);
  const [certificateNumber,setCertificateNumber] = useState("");
  const [recipient,setRecipient] = useState("");
  const [file,setFile] = useState(null);
  const [result,setResult] = useState(null);
  const [qr,setQr] = useState("");
  const [busy,setBusy] = useState(false);
  const [notice,setNotice] = useState("");
  const [tab,setTab] = useState("verify");
  const [lookupId,setLookupId] = useState(new URLSearchParams(window.location.search).get("cert") || "");
  const readProvider = useMemo(() => RPC_URL ? new JsonRpcProvider(RPC_URL) : null, []);
  const isConfigured = /^0x[0-9a-fA-F]{40}$/.test(contractAddress);

  function getReadContract() {
    if (!isConfigured) throw new Error("Set VITE_CONTRACT_ADDRESS in frontend/.env and restart Vite.");
    const provider = readProvider || (window.ethereum ? new BrowserProvider(window.ethereum) : null);
    if (!provider) throw new Error("Configure VITE_RPC_URL for wallet-free verification.");
    return new Contract(contractAddress,ABI,provider);
  }

  async function connectWallet() {
    try {
      if (!window.ethereum) throw new Error("MetaMask browser extension was not detected.");
      const provider = new BrowserProvider(window.ethereum);
      const network = await provider.getNetwork();
      if (Number(network.chainId) !== CHAIN_ID) throw new Error(`Switch MetaMask to chain ID ${CHAIN_ID}.`);
      const accounts = await provider.send("eth_requestAccounts",[]);
      setWallet(accounts[0]); setNotice("Wallet connected.");
    } catch(error) { setNotice(error.shortMessage || error.message); }
  }

  async function verify(id=lookupId) {
    setBusy(true); setNotice(""); setResult(null); setQr("");
    try {
      if (!/^0x[0-9a-fA-F]{64}$/.test(id)) throw new Error("Certificate ID must be 0x followed by 64 hexadecimal characters.");
      const contract=getReadContract();
      const [valid,cert]=await Promise.all([contract.verifyCertificate(id),contract.getCertificate(id)]);
      const data={certificateId:id,status:valid?"VALID":"REVOKED",recipient:cert.recipient,issuer:cert.issuer,documentHash:cert.documentHash,ipfsCid:cert.ipfsCid,issuedAt:new Date(Number(cert.issuedAt)*1000).toLocaleString(),revoked:cert.revoked};
      setResult(data);
      const url=new URL(window.location.href); url.searchParams.set("cert",id); url.searchParams.set("contract",contractAddress);
      setQr(await QRCode.toDataURL(url.toString(),{width:260,margin:2}));
    } catch(error) { setNotice(error.shortMessage || error.reason || error.message || "Verification failed."); }
    finally { setBusy(false); }
  }

  async function issue(event) {
    event.preventDefault(); setBusy(true); setNotice(""); setResult(null);
    try {
      if (!window.ethereum) throw new Error("Install MetaMask to issue certificates.");
      if (!file) throw new Error("Choose the certificate PDF or image.");
      if (!certificateNumber.trim()) throw new Error("Enter a unique certificate number.");
      if (!/^0x[0-9a-fA-F]{40}$/.test(recipient)) throw new Error("Enter a valid recipient wallet address.");
      const provider=new BrowserProvider(window.ethereum);
      const network=await provider.getNetwork();
      if (Number(network.chainId)!==CHAIN_ID) throw new Error(`Switch MetaMask to chain ID ${CHAIN_ID}.`);
      const signer=await provider.getSigner();
      const account=await signer.getAddress();
      if ((await getReadContract().owner()).toLowerCase()!==account.toLowerCase()) throw new Error("Connected wallet is not the contract owner/admin.");
      const id=keccak256(toUtf8Bytes(certificateNumber.trim()));
      const documentHash=await hashFile(file);
      setNotice("Uploading document to IPFS…");
      const form=new FormData(); form.append("file",file);
      const uploadResponse=await fetch(`${API_URL}/api/ipfs/upload`,{method:"POST",body:form});
      const uploadData=await uploadResponse.json();
      if (!uploadResponse.ok) throw new Error(uploadData.error || "IPFS upload failed.");
      setNotice("Confirm the issue transaction in MetaMask…");
      const contract=new Contract(contractAddress,ABI,signer);
      const tx=await contract.issueCertificate(id,recipient,documentHash,uploadData.cid);
      setNotice(`Transaction submitted: ${tx.hash}. Waiting for confirmation…`);
      await tx.wait();
      setCertificateNumber(""); setRecipient(""); setFile(null); setLookupId(id);
      await verify(id);
      setNotice("Certificate issued successfully. Verification details are ready below.");
      setTab("verify");
    } catch(error) { setNotice(error.shortMessage || error.reason || error.message || "Issuance failed."); }
    finally { setBusy(false); }
  }

  async function revoke() {
    if (!result?.certificateId) return;
    setBusy(true); setNotice("");
    try {
      if (!window.ethereum) throw new Error("Connect MetaMask to revoke.");
      const provider=new BrowserProvider(window.ethereum);
      const network=await provider.getNetwork();
      if (Number(network.chainId)!==CHAIN_ID) throw new Error(`Switch MetaMask to chain ID ${CHAIN_ID}.`);
      const signer=await provider.getSigner();
      const contract=new Contract(contractAddress,ABI,signer);
      const tx=await contract.revokeCertificate(result.certificateId);
      setNotice(`Revocation submitted: ${tx.hash}`); await tx.wait();
      setNotice("Certificate revoked on-chain."); await verify(result.certificateId);
    } catch(error) { setNotice(error.shortMessage || error.reason || error.message || "Revocation failed."); }
    finally { setBusy(false); }
  }

  useEffect(() => {
    const params=new URLSearchParams(window.location.search);
    const contract=params.get("contract");
    if (contract && /^0x[0-9a-fA-F]{40}$/.test(contract)) setContractAddress(contract);
    const id=params.get("cert");
    if (id && /^0x[0-9a-fA-F]{64}$/.test(id)) setLookupId(id);
  },[]);

  useEffect(() => {
    const params=new URLSearchParams(window.location.search);
    const id=params.get("cert");
    const address=params.get("contract") || CONTRACT_ADDRESS;
    if (id && /^0x[0-9a-fA-F]{64}$/.test(id) && /^0x[0-9a-fA-F]{40}$/.test(address)) {
      const timer=window.setTimeout(() => verify(id),0);
      return () => window.clearTimeout(timer);
    }
  },[]);

  return <main className="app-shell">
    <nav className="topbar">
      <a className="brand" href="/">Certi<span>Chain</span><small>BLOCKCHAIN CREDENTIALS</small></a>
      <div className="nav-actions"><span className="network"><i/> {CHAIN_ID===31337?"Anvil Local":CHAIN_ID===11155111?"Sepolia Testnet":`Chain ${CHAIN_ID}`}</span><button className="button button-outline" onClick={connectWallet}>{wallet?short(wallet):"Connect wallet"}</button></div>
    </nav>
    <section className="hero">
      <div className="eyebrow"><span/> TRUST, WITHOUT THE PAPER TRAIL</div>
      <h1>Credentials you can<br/><em>prove, not just claim.</em></h1>
      <p>Issue tamper-evident certificates, store documents on IPFS, and verify authenticity on the blockchain in seconds.</p>
      <div className="hero-stats"><span><b>01</b> Issue on-chain</span><span><b>02</b> Store on IPFS</span><span><b>03</b> Verify anywhere</span></div>
    </section>
    <section className="workspace">
      <div className="tabs"><button className={tab==="verify"?"active":""} onClick={()=>setTab("verify")}>Verify certificate</button><button className={tab==="issue"?"active":""} onClick={()=>setTab("issue")}>Issue certificate <span>ADMIN</span></button></div>
      {tab==="verify" ? <div className="panel">
        <div className="panel-heading"><div><div className="eyebrow">PUBLIC VERIFICATION</div><h2>Check a credential</h2><p>No wallet connection required when a public RPC is configured.</p></div><div className="panel-icon">✓</div></div>
        <label htmlFor="contract">Smart contract address</label><input id="contract" value={contractAddress} onChange={e=>setContractAddress(e.target.value)} placeholder="0x contract address"/>
        <label htmlFor="certificate">Certificate ID</label><div className="input-row"><input id="certificate" value={lookupId} onChange={e=>setLookupId(e.target.value)} placeholder="0x… 64 hexadecimal characters"/><button className="button button-primary" onClick={()=>verify()} disabled={busy}>{busy?"Checking…":"Verify"}</button></div>
        {result && <div className="result-card">
          <div className="status-line"><span className={result.status==="VALID"?"status status-valid":"status status-revoked"}>{result.status==="VALID"?"✓ VALID CERTIFICATE":"✕ REVOKED CERTIFICATE"}</span><span className="muted">ON-CHAIN RECORD</span></div>
          <div className="details-grid"><div><small>Recipient wallet</small><strong>{short(result.recipient)}</strong></div><div><small>Issuing wallet</small><strong>{short(result.issuer)}</strong></div><div><small>Issued at</small><strong>{result.issuedAt}</strong></div><div><small>Document hash (SHA-256)</small><strong>{short(result.documentHash)}</strong></div></div>
          <div className="cid-row"><span>IPFS document</span><a href={`https://gateway.pinata.cloud/ipfs/${result.ipfsCid}`} target="_blank" rel="noreferrer">{short(result.ipfsCid)} ↗</a></div>
          {qr && <div className="qr-area"><img src={qr} alt="Certificate verification QR code"/><div><b>Share verification</b><p>Scan this QR code to open this certificate's public verification link.</p><button className="button button-outline" onClick={()=>navigator.clipboard.writeText(window.location.href)}>Copy link</button></div></div>}
          {result.status==="VALID" && wallet.toLowerCase()===result.issuer.toLowerCase() && <button className="button button-danger" onClick={revoke} disabled={busy}>Revoke this certificate</button>}
        </div>}
      </div> : <form className="panel" onSubmit={issue}>
        <div className="panel-heading"><div><div className="eyebrow">INSTITUTION DASHBOARD</div><h2>Issue a certificate</h2><p>Only the smart contract owner can issue new credentials.</p></div><div className="panel-icon">＋</div></div>
        <label htmlFor="contract-admin">Smart contract address</label><input id="contract-admin" value={contractAddress} onChange={e=>setContractAddress(e.target.value)} placeholder="0x contract address"/>
        <label htmlFor="cert-number">Certificate number</label><input id="cert-number" value={certificateNumber} onChange={e=>setCertificateNumber(e.target.value)} placeholder="e.g. UNI-2026-0001" required/>
        <label htmlFor="recipient">Recipient wallet address</label><input id="recipient" value={recipient} onChange={e=>setRecipient(e.target.value)} placeholder="0x…" required/>
        <label htmlFor="document">Certificate document (PDF, PNG or JPG · max 10 MB)</label><input id="document" type="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" onChange={e=>setFile(e.target.files?.[0]||null)} required/>
        {file && <p className="file-note">Selected: {file.name} · {(file.size/1024/1024).toFixed(2)} MB</p>}
        <button className="button button-primary button-wide" type="submit" disabled={busy}>{busy?"Processing…":"Upload & issue certificate"}</button>
      </form>}
    </section>
    {notice && <div className="notice" role="status">{notice}</div>}
    <footer className="footer"><span>CertiChain © 2026</span><span>Built on Ethereum-compatible networks · Documents stored on IPFS</span></footer>
  </main>;
}
