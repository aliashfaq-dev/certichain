import React, { useEffect, useMemo, useState } from "react";
import { BrowserProvider, Contract, JsonRpcProvider, keccak256, toUtf8Bytes, isAddress } from "ethers";
import QRCode from "qrcode";

const ABI = [
  "function owner() view returns (address)",
  "function getUniversity(address wallet) view returns (tuple(bytes32 universityId,string name,bool active))",
  "function registerUniversity(address wallet,bytes32 universityId,string name)",
  "function setUniversityStatus(address wallet,bool active)",
  "function verifyCertificate(bytes32 certificateId) view returns (bool)",
  "function getCertificate(bytes32 certificateId) view returns (tuple(bytes32 universityId,address recipient,address issuer,bytes32 documentHash,string ipfsCid,uint256 issuedAt,bool revoked))",
  "function issueCertificate(bytes32 universityId,bytes32 certificateId,address recipient,bytes32 documentHash,string ipfsCid)",
  "function revokeCertificate(bytes32 certificateId)",
  "event UniversityRegistered(address indexed wallet,bytes32 indexed universityId,string name)",
  "event UniversityStatusChanged(address indexed wallet,bool active)",
  "event CertificateIssued(bytes32 indexed universityId,bytes32 indexed certificateId,address indexed recipient,address issuer,bytes32 documentHash,string ipfsCid,uint256 issuedAt)",
  "event CertificateRevoked(bytes32 indexed certificateId,address indexed issuer,uint256 revokedAt)"
];
const RPC_URL = import.meta.env.VITE_RPC_URL || "";
const CONTRACT_ADDRESS = import.meta.env.VITE_CONTRACT_ADDRESS || "";
const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";
const CHAIN_ID = Number(import.meta.env.VITE_CHAIN_ID || 11155111);
const CHAIN_HEX = "0x" + CHAIN_ID.toString(16);
const EXPLORER = CHAIN_ID === 11155111 ? "https://sepolia.etherscan.io" : "https://etherscan.io";
const short = (value) => value ? `${value.slice(0,8)}…${value.slice(-6)}` : "—";
const ipfsUrl = (cid) => `https://gateway.pinata.cloud/ipfs/${cid}`;

async function hashFile(file) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return "0x" + Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2,"0")).join("");
}

export default function App() {
  const [wallet,setWallet] = useState("");
  const [owner,setOwner] = useState("");
  const [universityProfile,setUniversityProfile] = useState(null);
  const [universityWalletInput,setUniversityWalletInput] = useState("");
  const [universityCodeInput,setUniversityCodeInput] = useState("");
  const [universityNameInput,setUniversityNameInput] = useState("");
  const [statusWalletInput,setStatusWalletInput] = useState("");
  const [statusActive,setStatusActive] = useState(false);
  const [contractAddress,setContractAddress] = useState(new URLSearchParams(window.location.search).get("contract") || CONTRACT_ADDRESS);
  const [page,setPage] = useState("verify");
  const [theme,setTheme] = useState(() => localStorage.getItem("certichain-theme") || "light");
  const [certificateNumber,setCertificateNumber] = useState("");
  const [recipient,setRecipient] = useState("");
  const [recipientEmail,setRecipientEmail] = useState("");
  const [file,setFile] = useState(null);
  const [lookupId,setLookupId] = useState(new URLSearchParams(window.location.search).get("cert") || "");
  const [result,setResult] = useState(null);
  const [qr,setQr] = useState("");
  const [shareUrl,setShareUrl] = useState("");
  const [studentCertificates,setStudentCertificates] = useState([]);
  const [emailCertificates,setEmailCertificates] = useState([]);
  const [studentEmail,setStudentEmail] = useState("");
  const [studentPassword,setStudentPassword] = useState("");
  const [studentToken,setStudentToken] = useState(() => sessionStorage.getItem("certichain-student-token") || "");
  const [studentAccountEmail,setStudentAccountEmail] = useState(() => sessionStorage.getItem("certichain-student-email") || "");
  const [busy,setBusy] = useState(false);
  const [notice,setNotice] = useState("");
  const readProvider = useMemo(() => RPC_URL ? new JsonRpcProvider(RPC_URL) : null, []);
  const isConfigured = /^0x[0-9a-fA-F]{40}$/.test(contractAddress);
  const networkName = CHAIN_ID===11155111 ? "Sepolia Testnet" : CHAIN_ID===1 ? "Ethereum Mainnet" : `Chain ${CHAIN_ID}`;
  const contractUrl = `${EXPLORER}/address/${contractAddress}`;

  function getReadContract() {
    if (!isConfigured) throw new Error("Configure VITE_CONTRACT_ADDRESS before using the admin portal.");
    const provider = readProvider || (window.ethereum ? new BrowserProvider(window.ethereum) : null);
    if (!provider) throw new Error("Public RPC is not configured. Set VITE_RPC_URL.");
    return new Contract(contractAddress,ABI,provider);
  }

  async function getWalletSigner() {
    if (!window.ethereum) throw new Error("Install MetaMask to connect a wallet.");
    let chainId = await window.ethereum.request({method:"eth_chainId"});
    if (Number(chainId) !== CHAIN_ID) {
      try {
        await window.ethereum.request({method:"wallet_switchEthereumChain",params:[{chainId:CHAIN_HEX}]});
      } catch (switchError) {
        if (switchError.code === 4902 && CHAIN_ID === 11155111) {
          await window.ethereum.request({method:"wallet_addEthereumChain",params:[{
            chainId:CHAIN_HEX,chainName:"Sepolia Test Network",
            nativeCurrency:{name:"Sepolia Ether",symbol:"ETH",decimals:18},
            rpcUrls:[RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com"],
            blockExplorerUrls:["https://sepolia.etherscan.io"]
          }]});
        } else { throw switchError; }
      }
      chainId = await window.ethereum.request({method:"eth_chainId"});
      if (Number(chainId) !== CHAIN_ID) throw new Error(`Switch MetaMask to ${networkName}.`);
    }
    const provider = new BrowserProvider(window.ethereum);
    const accounts = await provider.send("eth_requestAccounts",[]);
    if (!accounts.length) throw new Error("No wallet account was selected.");
    setWallet(accounts[0]);
    return {provider,signer:await provider.getSigner(),account:accounts[0]};
  }

  async function connectWallet() {
    try {
      const {account}=await getWalletSigner();
      setNotice("Wallet connected: " + short(account));
      if (page==="admin") await checkAdmin(account);
      if (page==="student") await loadStudentCertificates(account);
    } catch(error) { setNotice(error.shortMessage || error.message || "Wallet connection failed."); }
  }

  async function checkAdmin(account=wallet) {
    if (!account) { setOwner(""); return false; }
    try {
      const contract=getReadContract();
      const contractOwner=await contract.owner();
      setOwner(contractOwner);
      if (contractOwner.toLowerCase() === account.toLowerCase()) {
        setUniversityProfile(null);
        return true;
      }
      const university=await contract.getUniversity(account);
      const profile={universityId:university.universityId,name:university.name,active:university.active};
      setUniversityProfile(profile);
      if (!profile.active) {
        setNotice("Access denied: this university wallet is not registered or has been deactivated.");
        return false;
      }
      return true;
    } catch(error) {
      setOwner("");
      setNotice(error.shortMessage || error.message || "Could not verify admin access.");
      return false;
    }
  }

  async function verify(id=lookupId) {
    setBusy(true); setNotice(""); setResult(null); setQr("");
    try {
      if (!/^0x[0-9a-fA-F]{64}$/.test(id.trim())) throw new Error("Certificate ID ya document SHA-256 hash 0x + 64 hex characters hona chahiye.");
      const contract=getReadContract();
      let certificateId=id.trim();
      let cert;
      try {
        cert=await contract.getCertificate(certificateId);
      } catch {
        setNotice("Searching blockchain records…");
        const latest=await readProvider.getBlockNumber(); let match=null; for(let toBlock=latest;toBlock>=0;toBlock-=10000){const fromBlock=Math.max(0,toBlock-9999);const events=await contract.queryFilter(contract.filters.CertificateIssued(),fromBlock,toBlock);match=events.find(event=>String(event.args.documentHash).toLowerCase()===certificateId.toLowerCase());if(match) break;}
        if (!match) throw new Error("No certificate was found for this hash. Check the certificate ID or document hash.");
        certificateId=match.args.certificateId;
        cert=await contract.getCertificate(certificateId);
      }
      const valid=await contract.verifyCertificate(certificateId);
      const university=await contract.getUniversity(cert.issuer);
      const data={certificateId,universityId:cert.universityId,universityName:university.name,status:valid?"VALID":"REVOKED",recipient:cert.recipient,issuer:cert.issuer,documentHash:cert.documentHash,ipfsCid:cert.ipfsCid,issuedAt:new Date(Number(cert.issuedAt)*1000).toLocaleString(),revoked:cert.revoked};
      setResult(data);
      const url=new URL(window.location.href); url.searchParams.set("cert",certificateId); url.searchParams.set("contract",contractAddress);
      setShareUrl(url.toString());
      setQr(await QRCode.toDataURL(url.toString(),{width:240,margin:2}));
      setLookupId(certificateId);
      setNotice("");
    } catch(error) { setNotice(error.shortMessage || error.reason || error.message || "Verification failed."); }
    finally { setBusy(false); }
  }

  async function issue(event) {
    event.preventDefault(); setBusy(true); setNotice(""); setResult(null);
    try {
      const {signer,account}=await getWalletSigner();
      const contract=new Contract(contractAddress,ABI,signer);
      const university=await contract.getUniversity(account);
      if (!university.active) throw new Error("This wallet has not been authorized as a university issuer by the platform owner.");
      const universityId=university.universityId;
      setUniversityProfile({universityId,name:university.name,active:university.active});
      if (!file) throw new Error("Please select a certificate PDF or image.");
      if (!certificateNumber.trim()) throw new Error("Please enter a unique certificate number.");
      const normalizedEmail=recipientEmail.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) throw new Error("A valid student email address is required.");
      if (recipient.trim() && !isAddress(recipient.trim())) throw new Error("Enter a valid student wallet address or leave the field blank.");
      if (file.size>10*1024*1024) throw new Error("The file must be smaller than 10 MB.");
      const id=keccak256(toUtf8Bytes(`${universityId}:${certificateNumber.trim()}`));
      // If a student has no wallet, create a random opaque on-chain recipient reference.
      // Do not derive it from the email: the email itself and any reversible identifier stay off-chain.
      const randomRecipientBytes=crypto.getRandomValues(new Uint8Array(20));
      const generatedRecipient="0x"+Array.from(randomRecipientBytes,byte=>byte.toString(16).padStart(2,"0")).join("");
      const recipientAddress=recipient.trim() || generatedRecipient;
      const documentHash=await hashFile(file);
      setNotice("Uploading certificate to IPFS…");
      const form=new FormData(); form.append("file",file);
      let uploadResponse;
      try {
        uploadResponse=await fetch(`${API_URL.replace(/\/$/,"")}/api/ipfs/upload`,{method:"POST",body:form});
      } catch (networkError) {
        throw new Error(`Could not connect to the backend (${API_URL}). Check the backend deployment, CORS, and /api/health endpoint. Details: ${networkError.message}`);
      }
      const uploadData=await uploadResponse.json().catch(()=>({}));
      if (!uploadResponse.ok) throw new Error(uploadData.error || `IPFS upload failed (HTTP ${uploadResponse.status}). Check the backend PINATA_JWT configuration.`);
      setNotice("Confirm the issuance transaction in MetaMask…");
      const tx=await contract.issueCertificate(universityId,id,recipientAddress,documentHash,uploadData.cid);
      setNotice(`Transaction submitted: ${tx.hash}. Waiting for transaction confirmation…`);
      await tx.wait();
      setCertificateNumber(""); setRecipient(""); setRecipientEmail(""); setFile(null);
      setLookupId(id); setPage("verify");
      await verify(id);
      const verificationUrl=new URL(window.location.href);
      verificationUrl.searchParams.set("cert",id);
      verificationUrl.searchParams.set("contract",contractAddress);
      try {
        const emailResponse=await fetch(`${API_URL.replace(/\/$/,"")}/api/email/certificate-issued`,{
          method:"POST",
          headers:{"Content-Type":"application/json"},
          body:JSON.stringify({
            email:normalizedEmail,
            universityName:university.name,
            certificateNumber:certificateNumber.trim(),
            certificateId:id,
            verificationUrl:verificationUrl.toString(),
            documentUrl:ipfsUrl(uploadData.cid),
            transactionHash:tx.hash
          })
        });
        const emailData=await emailResponse.json().catch(()=>({}));
        if (!emailResponse.ok) {
          setNotice(`Certificate was issued on the blockchain, but the email could not be sent: ${emailData.error || "Check the email service configuration."}`);
        } else {
          setNotice("Certificate issued successfully. The student has been emailed the verification link and portal login details.");
        }
      } catch(emailError) {
        setNotice(`Certificate was issued on the blockchain, but the email service could not be reached: ${emailError.message}`);
      }
    } catch(error) { setNotice(error.shortMessage || error.reason || error.message || "Issuance failed."); }
    finally { setBusy(false); }
  }

  async function loadEmailCertificates(token=studentToken) {
    if (!token) return;
    const response=await fetch(API_URL.replace(/\/$/,"")+"/api/student/certificates",{headers:{Authorization:"Bearer "+token}});
    const payload=await response.json().catch(()=>({}));
    if (!response.ok) throw new Error(payload.error || "Could not load student certificates.");
    const contract=getReadContract();
    const records=await Promise.all((payload.certificates||[]).map(async item=>{
      const cert=await contract.getCertificate(item.certificateId);
      const university=await contract.getUniversity(cert.issuer);
      return {certificateId:item.certificateId,universityId:cert.universityId,universityName:university.name||item.universityName,recipient:cert.recipient,issuer:cert.issuer,documentHash:cert.documentHash,ipfsCid:cert.ipfsCid,issuedAt:new Date(Number(cert.issuedAt)*1000).toLocaleString(),revoked:cert.revoked};
    }));
    setEmailCertificates(records.reverse());
  }

  async function loginStudent(event) {
    event.preventDefault(); setBusy(true); setNotice("");
    try {
      const response=await fetch(API_URL.replace(/\/$/,"")+"/api/student/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:studentEmail.trim().toLowerCase(),password:studentPassword})});
      const payload=await response.json().catch(()=>({}));
      if (!response.ok) throw new Error(payload.error || "Student login failed.");
      sessionStorage.setItem("certichain-student-token",payload.token);
      sessionStorage.setItem("certichain-student-email",payload.email);
      setStudentToken(payload.token); setStudentAccountEmail(payload.email); setStudentPassword("");
      await loadEmailCertificates(payload.token); setNotice("Signed in successfully. Your certificates are ready.");
    } catch(error) { setNotice(error.message || "Student login failed."); }
    finally { setBusy(false); }
  }

  function logoutStudent() {
    sessionStorage.removeItem("certichain-student-token"); sessionStorage.removeItem("certichain-student-email");
    setStudentToken(""); setStudentAccountEmail(""); setEmailCertificates([]); setNotice("You have been signed out.");
  }

  async function loadStudentCertificates(account=wallet) {
    if (!account) { setNotice("Connect your student wallet."); return; }
    setBusy(true); setNotice("");
    try {
      const contract=getReadContract();
      const filter=contract.filters.CertificateIssued(null,null,account);
      const latest=await readProvider.getBlockNumber();
      const events=[];
      // Avoid oversized eth_getLogs requests: some RPCs return a generic
      // "could not coalesce error" when asked for the entire chain at once.
      const chunkSize=10000;
      for(let toBlock=latest;toBlock>=0;toBlock-=chunkSize) {
        const fromBlock=Math.max(0,toBlock-chunkSize+1);
        const chunk=await contract.queryFilter(filter,fromBlock,toBlock);
        events.push(...chunk);
      }
      const records=[];
      // Keep calls sequential to avoid provider batching/rate-limit errors.
      for(const event of events) {
        const id=event.args.certificateId;
        const cert=await contract.getCertificate(id);
        const university=await contract.getUniversity(cert.issuer);
        records.push({certificateId:id,universityId:cert.universityId,universityName:university.name,recipient:cert.recipient,issuer:cert.issuer,documentHash:cert.documentHash,ipfsCid:cert.ipfsCid,issuedAt:new Date(Number(cert.issuedAt)*1000).toLocaleString(),revoked:cert.revoked});
      }
      setStudentCertificates(records.reverse());
      if (!records.length) setNotice("No certificates were found for this wallet address.");
    } catch(error) { setNotice(error.shortMessage || error.reason || error.message || "Could not load certificates. Check the RPC provider limits."); }
    finally { setBusy(false); }
  }

  async function registerUniversity(event) {
    event.preventDefault(); setBusy(true); setNotice("");
    try {
      const {signer}=await getWalletSigner();
      const contract=new Contract(contractAddress,ABI,signer);
      const contractOwner=await contract.owner();
      if (contractOwner.toLowerCase()!==wallet.toLowerCase()) throw new Error("Only the platform owner can register a university.");
      if (!isAddress(universityWalletInput)) throw new Error("Enter a valid university wallet address.");
      if (!universityCodeInput.trim() || !universityNameInput.trim()) throw new Error("Both university code and name are required.");
      const universityId=keccak256(toUtf8Bytes(universityCodeInput.trim().toUpperCase()));
      const tx=await contract.registerUniversity(universityWalletInput,universityId,universityNameInput.trim());
      setNotice(`University registration submitted: ${tx.hash}. Confirmation ka wait…`);
      await tx.wait();
      setUniversityWalletInput(""); setUniversityCodeInput(""); setUniversityNameInput("");
      setNotice("University authorized successfully. It can now issue certificates from its wallet.");
    } catch(error) { setNotice(error.shortMessage || error.reason || error.message || "University registration failed."); }
    finally { setBusy(false); }
  }

  async function changeUniversityStatus(event) {
    event.preventDefault(); setBusy(true); setNotice("");
    try {
      const {signer}=await getWalletSigner();
      const contract=new Contract(contractAddress,ABI,signer);
      if ((await contract.owner()).toLowerCase()!==wallet.toLowerCase()) throw new Error("Only the platform owner can change university status.");
      if (!isAddress(statusWalletInput)) throw new Error("Enter a valid university wallet address.");
      const tx=await contract.setUniversityStatus(statusWalletInput,statusActive);
      setNotice(`University status transaction submitted: ${tx.hash}`);
      await tx.wait();
      setNotice(statusActive?"University reactivated successfully.":"University deactivated successfully.");
      setStatusWalletInput("");
    } catch(error) { setNotice(error.shortMessage || error.reason || error.message || "University status update failed."); }
    finally { setBusy(false); }
  }

  async function revoke() {
    if (!result?.certificateId) return;
    setBusy(true); setNotice("");
    try {
      const {signer}=await getWalletSigner();
      const contract=new Contract(contractAddress,ABI,signer);
      const tx=await contract.revokeCertificate(result.certificateId);
      setNotice(`Revocation submitted: ${tx.hash}. Confirmation ka wait…`);
      await tx.wait();
      await verify(result.certificateId);
      setNotice("Certificate revoked successfully on the blockchain.");
    } catch(error) { setNotice(error.shortMessage || error.reason || error.message || "Revocation failed."); }
    finally { setBusy(false); }
  }

  useEffect(()=>{document.documentElement.dataset.theme=theme;localStorage.setItem("certichain-theme",theme)},[theme]);
  useEffect(()=>{
    if (window.ethereum) {
      const onAccounts=accounts=>{setWallet(accounts?.[0]||"");setOwner("")};
      const onChain=()=>{setWallet("");setOwner("");setNotice("Network changed. Reconnect your wallet.")};
      window.ethereum.on?.("accountsChanged",onAccounts);
      window.ethereum.on?.("chainChanged",onChain);
      return ()=>{window.ethereum.removeListener?.("accountsChanged",onAccounts);window.ethereum.removeListener?.("chainChanged",onChain)};
    }
  },[]);
  useEffect(()=>{
    const params=new URLSearchParams(window.location.search);
    const cert=params.get("cert");
    if (cert) {setPage("verify");setLookupId(cert);window.setTimeout(()=>verify(cert),0)}
  },[]);

  const navItems=[["verify","Public verification"],["student","Student portal"],["admin","Admin portal"]];
  const openStudent=async()=>{setPage("student");if(wallet) await loadStudentCertificates(wallet)};
  const openAdmin=async()=>{setPage("admin");if(wallet) await checkAdmin(wallet)};
  const copyShare=async(url)=>{try{await navigator.clipboard.writeText(url);setNotice("Share link copied.")}catch{setNotice("Browser clipboard permission was not granted.")}};

  return <main className="app-shell">
    <nav className="topbar">
      <a className="brand" href="/" onClick={e=>{e.preventDefault();setPage("verify")}}>Certi<span>Chain</span><small>BLOCKCHAIN CREDENTIALS</small></a>
      <div className="nav-actions">
        <span className="network"><i/> {networkName}</span>
        <button className="button button-theme" onClick={()=>setTheme(t=>t==="light"?"dark":"light")}>{theme==="light"?"☾ Dark":"☀ Light"}</button>
        <button className="button button-outline" onClick={connectWallet}>{wallet?short(wallet):"Connect wallet"}</button>
      </div>
    </nav>
    <div className="portal-nav" role="navigation" aria-label="Main sections">
      {navItems.map(([key,label])=><button key={key} className={page===key?"active":""} onClick={()=>key==="student"?openStudent():key==="admin"?openAdmin():setPage(key)}>{label}{key==="admin"&&<span>RESTRICTED</span>}</button>)}
    </div>

    {page==="verify" && <>
      <section className="hero">
        <div className="eyebrow"><span/> OPEN, INDEPENDENT VERIFICATION</div>
        <h1>Verify credentials.<br/><em>Trust the record.</em></h1>
        <p>Enter a certificate ID or document SHA-256 hash to verify authenticity against the blockchain. No wallet required.</p>
        <div className="hero-stats"><span><b>01</b> On-chain proof</span><span><b>02</b> Issuer identity</span><span><b>03</b> Public verification</span></div>
      </section>
      <section className="workspace">
        <div className="panel">
          <div className="panel-heading"><div><div className="eyebrow">PUBLIC VERIFICATION</div><h2>Check a certificate</h2><p>Paste the certificate ID or SHA-256 document hash provided by the student or institution.</p></div><div className="panel-icon">✓</div></div>
          <label htmlFor="contract">Smart contract address</label><input id="contract" value={contractAddress} onChange={e=>setContractAddress(e.target.value)} placeholder="0x contract address"/>
          <label htmlFor="certificate">Certificate ID / Document hash</label>
          <div className="input-row"><input id="certificate" value={lookupId} onChange={e=>setLookupId(e.target.value)} placeholder="0x + 64 hexadecimal characters"/><button className="button button-primary" onClick={()=>verify()} disabled={busy}>{busy?"Checking…":"Verify certificate"}</button></div>
          {result && <div className="result-card">
            <div className="status-line"><span className={result.status==="VALID"?"status status-valid":"status status-revoked"}>{result.status==="VALID"?"✓ VALID CERTIFICATE":"✕ REVOKED CERTIFICATE"}</span><span className="muted">BLOCKCHAIN RECORD</span></div>
            <div className="details-grid"><div><small>Certificate ID</small><strong>{short(result.certificateId)}</strong></div><div><small>University</small><strong>{result.universityName || short(result.universityId)}</strong></div><div><small>University ID</small><strong>{short(result.universityId)}</strong></div><div><small>Recipient reference</small><strong>{short(result.recipient)}</strong></div><div><small>Issued by</small><strong>{short(result.issuer)}</strong></div><div><small>Issued at</small><strong>{result.issuedAt}</strong></div><div><small>Document SHA-256</small><strong>{short(result.documentHash)}</strong></div><div><small>Revocation status</small><strong>{result.revoked?"Revoked":"Not revoked"}</strong></div></div>
            <div className="cid-row"><span>Issuer wallet</span><a href={`${EXPLORER}/address/${result.issuer}`} target="_blank" rel="noreferrer">{result.issuer} ↗</a></div>
            <div className="cid-row"><span>IPFS certificate file</span><a href={ipfsUrl(result.ipfsCid)} target="_blank" rel="noreferrer">View / download document ↗</a></div>
            <div className="cid-row"><span>Blockchain record</span><a href={`${EXPLORER}/address/${contractAddress}`} target="_blank" rel="noreferrer">View contract ↗</a></div>
            {qr && <div className="qr-area"><img src={qr} alt="Certificate verification QR code"/><div><b>Share public verification</b><p>Share this secure link or QR code so anyone can independently verify the record.</p><button className="button button-outline" onClick={()=>copyShare(shareUrl)}>Copy verification link</button></div></div>}
            {wallet.toLowerCase()===result.issuer.toLowerCase() && !result.revoked && <button className="button button-danger" onClick={revoke} disabled={busy}>Revoke certificate</button>}
          </div>}
        </div>
      </section>
    </>}

    {page==="student" && <>
      <section className="hero portal-hero"><div className="eyebrow">STUDENT SPACE</div><h1>Your achievements.<br/><em>Always verifiable.</em></h1><p>Connect the wallet that received your certificates to see your credentials, download original files and share verification links.</p></section>
      <section className="workspace"><div className="panel">
        <div className="panel-heading"><div><div className="eyebrow">MY CREDENTIALS</div><h2>My certificates</h2><p>Sign in with your email or connect the wallet that received your certificates.</p></div><div className="panel-icon">▤</div></div>
        <div className="student-login">
          <h3>Student email login</h3>
          {studentToken ? <div className="student-wallet"><span>Signed in as</span><strong>{studentAccountEmail}</strong><button className="button button-outline" onClick={()=>loadEmailCertificates()} disabled={busy}>Refresh certificates</button><button className="button button-outline" onClick={logoutStudent}>Sign out</button></div> : <form onSubmit={loginStudent}>
            <label htmlFor="student-email">Email address</label><input id="student-email" type="email" value={studentEmail} onChange={e=>setStudentEmail(e.target.value)} placeholder="student@example.com" autoComplete="email" required/>
            <label htmlFor="student-password">Password</label><input id="student-password" type="password" value={studentPassword} onChange={e=>setStudentPassword(e.target.value)} placeholder="Enter your password" autoComplete="current-password" required/>
            <button className="button button-primary button-wide" type="submit" disabled={busy}>{busy?"Signing in…":"Sign in to student portal"}</button>
          </form>}
          {studentToken && <div className="certificate-list">
            {emailCertificates.map(cert=><article className="student-cert" key={cert.certificateId}>
              <div className="status-line"><span className={cert.revoked?"status status-revoked":"status status-valid"}>{cert.revoked?"REVOKED":"VERIFIED CREDENTIAL"}</span><span className="muted">{cert.issuedAt}</span></div>
              <h3>Certificate {short(cert.certificateId)}</h3><p>{cert.universityName || "University"} · ID: <strong>{short(cert.universityId)}</strong></p>
              <p>Issued by <strong>{short(cert.issuer)}</strong></p><p className="cert-hash">Document hash: {short(cert.documentHash)}</p>
              <div className="student-cert-actions"><a className="button button-primary" href={ipfsUrl(cert.ipfsCid)} target="_blank" rel="noreferrer">View / download</a><button className="button button-outline" onClick={()=>{setLookupId(cert.certificateId);setPage("verify");verify(cert.certificateId)}}>Verify</button></div>
            </article>)}
            {!emailCertificates.length && <div className="empty-state">No certificates are linked to this email address yet.</div>}
          </div>}
        </div>
        <div className="student-wallet-actions"><span>Or use your connected wallet</span><button className="button button-outline" onClick={connectWallet}>{wallet?short(wallet):"Connect student wallet"}</button></div>
        {!wallet ? null : <><div className="student-wallet"><span>Connected wallet</span><strong>{wallet}</strong><button className="button button-outline" onClick={()=>loadStudentCertificates(wallet)} disabled={busy}>{busy?"Loading…":"Refresh certificates"}</button></div>
        <div className="certificate-list">
          {studentCertificates.map(cert=><article className="student-cert" key={cert.certificateId}>
            <div className="status-line"><span className={cert.revoked?"status status-revoked":"status status-valid"}>{cert.revoked?"REVOKED":"VERIFIED CREDENTIAL"}</span><span className="muted">{cert.issuedAt}</span></div>
            <h3>Certificate {short(cert.certificateId)}</h3>
            <p>{cert.universityName || "University"} · ID: <strong>{short(cert.universityId)}</strong></p>
            <p>Issued by <strong>{short(cert.issuer)}</strong></p>
            <p className="cert-hash">Document hash: {short(cert.documentHash)}</p>
            <div className="student-cert-actions"><a className="button button-primary" href={ipfsUrl(cert.ipfsCid)} target="_blank" rel="noreferrer">View / download</a><button className="button button-outline" onClick={()=>{const url=new URL(window.location.href);url.searchParams.set("cert",cert.certificateId);url.searchParams.set("contract",contractAddress);copyShare(url.toString())}}>Share certificate</button><button className="button button-outline" onClick={()=>{setLookupId(cert.certificateId);setPage("verify");verify(cert.certificateId)}}>Verify</button></div>
          </article>)}
          {!studentCertificates.length && wallet && <div className="empty-state">No certificates found for this wallet yet.</div>}
        </div></>}
      </div></section>
    </>}

    {page==="admin" && <>
      <section className="hero portal-hero"><div className="eyebrow">INSTITUTION CONTROL CENTER</div><h1>Admin portal.<br/><em>Issue with authority.</em></h1><p>The platform owner authorizes universities. Each institution issues and revokes its own credentials, with every transaction recorded on-chain.</p></section>
      <section className="workspace"><div className="panel">
        <div className="panel-heading"><div><div className="eyebrow">INSTITUTION CONTROL CENTER</div><h2>University & issuer management</h2><p>Platform owner authorizes institutions. Each authorized university wallet pays its own issuance gas fees.</p></div><div className="panel-icon">⌑</div></div>
        {!wallet ? <button className="button button-primary" onClick={connectWallet}>Connect university / platform wallet</button> : owner.toLowerCase()===wallet.toLowerCase() ? <>
          <div className="admin-authorized"><span>PLATFORM OWNER ACCESS</span><strong>{short(wallet)}</strong></div>
          <form onSubmit={registerUniversity}>
            <h3>Authorize a university</h3>
            <label htmlFor="university-name">University name</label><input id="university-name" value={universityNameInput} onChange={e=>setUniversityNameInput(e.target.value)} placeholder="e.g. Example University" required/>
            <label htmlFor="university-code">Unique university code</label><input id="university-code" value={universityCodeInput} onChange={e=>setUniversityCodeInput(e.target.value)} placeholder="e.g. EXU" required/>
            <label htmlFor="university-wallet">University issuer wallet</label><input id="university-wallet" value={universityWalletInput} onChange={e=>setUniversityWalletInput(e.target.value)} placeholder="0x university wallet…" required/>
            <button className="button button-primary button-wide" type="submit" disabled={busy}>{busy?"Processing…":"Authorize university"}</button>
          </form>
          <form onSubmit={changeUniversityStatus}>
            <h3>Activate / deactivate university</h3>
            <label htmlFor="status-wallet">Registered university wallet</label><input id="status-wallet" value={statusWalletInput} onChange={e=>setStatusWalletInput(e.target.value)} placeholder="0x university wallet…" required/>
            <label htmlFor="status-active">New status</label><select id="status-active" value={statusActive?"true":"false"} onChange={e=>setStatusActive(e.target.value==="true")}><option value="false">Deactivate</option><option value="true">Reactivate</option></select>
            <button className="button button-outline button-wide" type="submit" disabled={busy}>Update university status</button>
          </form>
          <div className="admin-security-note">Only the platform owner can authorize or deactivate university wallets. This wallet does not issue university certificates unless separately registered as an issuer.</div>
        </> : universityProfile?.active ? <>
          <div className="admin-authorized"><span>UNIVERSITY ISSUER AUTHORIZED</span><strong>{universityProfile.name} · {short(universityProfile.universityId)}</strong><small>{short(wallet)}</small></div>
          <form onSubmit={issue}>
            <label htmlFor="contract-admin">Smart contract address</label><input id="contract-admin" value={contractAddress} onChange={e=>setContractAddress(e.target.value)} placeholder="0x contract address"/>
            <label htmlFor="cert-number">Certificate number (unique within your university)</label><input id="cert-number" value={certificateNumber} onChange={e=>setCertificateNumber(e.target.value)} placeholder="e.g. 2026-CS-0001" required/>
            <label htmlFor="recipient-email">Student email address <span className="required-mark">REQUIRED</span></label><input id="recipient-email" type="email" value={recipientEmail} onChange={e=>setRecipientEmail(e.target.value)} placeholder="student@example.com" autoComplete="email" required/>
            <label htmlFor="recipient">Student wallet address <span className="optional-mark">OPTIONAL</span></label><input id="recipient" value={recipient} onChange={e=>setRecipient(e.target.value)} placeholder="0x student wallet (optional)"/>
            <p className="file-note">If the student does not have a wallet, leave this field blank. A private recipient reference will be generated automatically.</p>
            <label htmlFor="document">Certificate document (PDF, PNG or JPG · max 10 MB)</label><input id="document" type="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" onChange={e=>setFile(e.target.files?.[0]||null)} required/>
            {file && <p className="file-note">Selected: {file.name} · {(file.size/1024/1024).toFixed(2)} MB</p>}
            <button className="button button-primary button-wide" type="submit" disabled={busy}>{busy?"Processing…":"Upload & issue certificate"}</button>
          </form>
          <div className="admin-security-note">Your university wallet pays the gas fee for each issue/revoke transaction. Certificate IDs are namespaced by your unique university ID.</div>
        </> : <div className="access-denied"><strong>Access restricted</strong><p>This wallet is not an active registered university issuer or the platform owner.</p><button className="button button-outline" onClick={()=>checkAdmin(wallet)}>Check authorization again</button></div>}
      </div></section>
    </>}

    {notice && (/Uploading|Waiting for|Searching blockchain|Confirm the issuance transaction|Transaction submitted/i.test(notice) ? <div className="notice" role="status">{notice}</div> : <div className="alert-backdrop" role="presentation" onClick={()=>setNotice("")}><section className="custom-alert" role="alertdialog" aria-modal="true" aria-label="Notification" onClick={event=>event.stopPropagation()}><div className={/failed|error|invalid|denied|not found|unavailable|could not|rejected|expired|required|must be|not configured/i.test(notice)?"alert-icon alert-error":"alert-icon"}>{/failed|error|invalid|denied|not found|unavailable|could not|rejected|expired|required|must be|not configured/i.test(notice)?"!":"✓"}</div><h3>{/failed|error|invalid|denied|not found|unavailable|could not|rejected|expired|required|must be|not configured/i.test(notice)?"Something went wrong":"Notification"}</h3><p>{notice}</p><button className="button button-primary" onClick={()=>setNotice("")}>Got it</button></section></div>)}
    <footer className="footer"><span>CertiChain © 2026</span><span>Ethereum-compatible network · IPFS document storage</span></footer>
  </main>;
}
