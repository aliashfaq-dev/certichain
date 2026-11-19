import { useState } from "react";
import { BrowserProvider, Contract } from "ethers";

const ABI = [
  "function verifyCertificate(bytes32 certificateId) view returns (bool)",
  "function getCertificate(bytes32 certificateId) view returns (tuple(address recipient,address issuer,bytes32 documentHash,string ipfsCid,uint256 issuedAt,bool revoked))"
];

export default function App() {
  const [wallet, setWallet] = useState("");
  const [contractAddress, setContractAddress] = useState("");
  const [certificateId, setCertificateId] = useState("");
  const [result, setResult] = useState("");
  const [busy, setBusy] = useState(false);

  async function connectWallet() {
    if (!window.ethereum) {
      setResult("MetaMask not detected. Install the MetaMask browser extension.");
      return;
    }
    const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
    setWallet(accounts[0]);
  }

  async function verify() {
    if (!window.ethereum) return setResult("Please install MetaMask to read the Sepolia contract.");
    if (!/^0x[0-9a-fA-F]{64}$/.test(certificateId)) {
      return setResult("Enter a certificate ID as a 32-byte hex value (0x followed by 64 hex characters).");
    }
    if (!/^0x[0-9a-fA-F]{40}$/.test(contractAddress)) {
      return setResult("Enter the deployed contract address first.");
    }
    setBusy(true);
    setResult("");
    try {
      const provider = new BrowserProvider(window.ethereum);
      const contract = new Contract(contractAddress, ABI, provider);
      const valid = await contract.verifyCertificate(certificateId);
      const cert = await contract.getCertificate(certificateId);
      setResult(JSON.stringify({
        status: valid ? "VALID" : "REVOKED",
        recipient: cert.recipient,
        issuer: cert.issuer,
        documentHash: cert.documentHash,
        ipfsCid: cert.ipfsCid,
        issuedAt: new Date(Number(cert.issuedAt) * 1000).toLocaleString()
      }, null, 2));
    } catch (error) {
      setResult(error.shortMessage || error.message || "Verification failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="shell">
      <header className="topbar">
        <a className="brand" href="/">Certi<span>Chain</span></a>
        <button className="wallet" onClick={connectWallet}>{wallet ? wallet.slice(0, 6) + "…" + wallet.slice(-4) : "Connect wallet"}</button>
      </header>
      <section className="hero">
        <p className="eyebrow">TRUST, VERIFIED ON-CHAIN</p>
        <h1>Verify certificates.<br /><span>Trust the proof.</span></h1>
        <p className="intro">Check whether an academic certificate exists on the blockchain and whether it has been revoked.</p>
      </section>
      <section className="panel">
        <label htmlFor="contract">Deployed contract address</label>
        <input id="contract" value={contractAddress} onChange={e => setContractAddress(e.target.value)} placeholder="0x…" />
        <label htmlFor="certificate">Certificate ID (bytes32)</label>
        <input id="certificate" value={certificateId} onChange={e => setCertificateId(e.target.value)} placeholder="0x + 64 hexadecimal characters" />
        <button className="verify" onClick={verify} disabled={busy}>{busy ? "Checking…" : "Verify certificate"}</button>
        {result && <pre className="result">{result}</pre>}
      </section>
      <footer>CertiChain · Sepolia testnet starter · Never share private keys</footer>
    </main>
  );
}
