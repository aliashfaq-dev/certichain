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
  const [publicWalletLookup,setPublicWalletLookup] = useState("");
  const [universityTab,setUniversityTab] = useState("issue");
  const [universityHistory,setUniversityHistory] = useState([]);
  const [historySort,setHistorySort] = useState("newest");
  const [nextCertificateNumber,setNextCertificateNumber] = useState("");
  const [emailCertificates,setEmailCertificates] = useState([]);
  const [studentEmail,setStudentEmail] = useState("");
  const [studentPassword,setStudentPassword] = useState("");
  const [studentToken,setStudentToken] = useState(() => sessionStorage.getItem("certichain-student-token") || "");
  const [studentAccountEmail,setStudentAccountEmail] = useState(() => sessionStorage.getItem("certichain-student-email") || "");
  const [universityToken,setUniversityToken]=useState(()=>sessionStorage.getItem("certichain-university-token")||"");
  const [universityEmail,setUniversityEmail]=useState("");
  const [universityPassword,setUniversityPassword]=useState("");
  const [universityRegisterMode,setUniversityRegisterMode]=useState(false);
  const [universityAccount,setUniversityAccount]=useState(null);
  const [universityTemplates,setUniversityTemplates]=useState([]);
  const [templateName,setTemplateName]=useState("");
  const [templateFile,setTemplateFile]=useState(null);
  const [profileName,setProfileName]=useState("");
  const [profileCode,setProfileCode]=useState("");
  const [currentUniversityPassword,setCurrentUniversityPassword]=useState("");
  const [newUniversityPassword,setNewUniversityPassword]=useState("");
  const [busy,setBusy] = useState(false);
  const [notice,setNotice] = useState("");
  const readProvider = useMemo(() => RPC_URL ? new JsonRpcProvider(RPC_URL, undefined, { batchMaxCount: 1 }) : null, []);
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
      if (profile.active) await loadUniversityHistory(account);
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
      if (!/^0x[0-9a-fA-F]{64}$/.test(id.trim())) throw new Error("Enter a certificate ID or SHA-256 document hash in 0x format.");
      const contract=getReadContract();
      let certificateId=id.trim();
      let cert;
      try {
        cert=await contract.getCertificate(certificateId);
      } catch {
        setNotice("Searching blockchain records…");
        const latest=await readProvider.getBlockNumber(); let match=null; const deploymentBlock=Math.max(0,Number(import.meta.env.VITE_CONTRACT_START_BLOCK || 12175745)); for(let toBlock=latest;toBlock>=deploymentBlock;){const fromBlock=Math.max(deploymentBlock,toBlock-499);const events=await contract.queryFilter(contract.filters.CertificateIssued(),fromBlock,toBlock);match=events.find(event=>String(event.args.documentHash).toLowerCase()===certificateId.toLowerCase());if(match) break;toBlock=fromBlock-1;}
        if (!match) throw new Error("No certificate was found for this hash. Check the certificate ID or document hash.");
        certificateId=match.args.certificateId;
        cert=await contract.getCertificate(certificateId);
      }
      const valid=await contract.verifyCertificate(certificateId);
      const university=await contract.getUniversity(cert.issuer);
      const data={certificateId,universityId:cert.universityId,universityName:university.name,status:valid?"VALID":"REVOKED",recipient:cert.recipient,issuer:cert.issuer,documentHash:cert.documentHash,ipfsCid:cert.ipfsCid,issuedAt:new Date(Number(cert.issuedAt)*1000).toLocaleString(),revoked:cert.revoked};
      setResult(data);
      const url=new URL(window.location.href); url.searchParams.set("cert",certificateId); url.searchParams.delete("contract");
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
      if (!nextCertificateNumber) throw new Error("Certificate number is not ready. Refresh certificate history.");
      const sequenceResponse=await fetch(`${API_URL.replace(/\/$/,"")}/api/university/next-number`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({wallet:account,universityId:String(university.universityId),universityName:String(university.name)})});
      const sequenceData=await sequenceResponse.json().catch(()=>({}));
      if(!sequenceResponse.ok || !sequenceData.certificateNumber) throw new Error(sequenceData.error || "Could not reserve a unique certificate number.");
      const issuedNumber=sequenceData.certificateNumber;
      setNextCertificateNumber(issuedNumber);
      const normalizedEmail=recipientEmail.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) throw new Error("A valid student email address is required.");
      if (recipient.trim() && !isAddress(recipient.trim())) throw new Error("Enter a valid student wallet address or leave the field blank.");
      if (file.size>10*1024*1024) throw new Error("The file must be smaller than 10 MB.");
      const id=keccak256(toUtf8Bytes(`${universityId}:${issuedNumber}`));
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
      verificationUrl.searchParams.delete("contract");
      try {
        const emailResponse=await fetch(`${API_URL.replace(/\/$/,"")}/api/email/certificate-issued`,{
          method:"POST",
          headers:{"Content-Type":"application/json"},
          body:JSON.stringify({
            email:normalizedEmail,
            universityName:university.name,
            certificateNumber:issuedNumber,
            certificateId:id,
            verificationUrl:verificationUrl.toString(),
            documentUrl:ipfsUrl(uploadData.cid),
            transactionHash:tx.hash,
             universityWallet:account,
             recipientWallet:recipientAddress,
             documentMimeType:file.type
          })
        });
        const emailData=await emailResponse.json().catch(()=>({}));
        if (!emailResponse.ok) {
          setNotice(`Certificate was issued on the blockchain, but the email could not be sent: ${emailData.error || "Check the email service configuration."}`);
        } else {
          await loadUniversityHistory(account);
          setNotice("Certificate issued and email sent with the PDF verification copy.");
        }
      } catch(emailError) {
        setNotice(`Certificate was issued on the blockchain, but the email service could not be reached: ${emailError.message}`);
      }
    } catch(error) { setNotice(error.shortMessage || error.reason || error.message || "Issuance failed."); }
    finally { setBusy(false); }
  }

  async function loadUniversityHistory(account=wallet) {
    if (!isAddress(account)) return;
    try {
      const url=API_URL.replace(/\/$/,"")+"/api/university/history?wallet="+encodeURIComponent(account);
      const response=await fetch(url);
      const payload=await response.json().catch(()=>({}));
      if (!response.ok) throw new Error(payload.error || "Could not load certificate history.");
      const records=payload.certificates || [];
      setUniversityHistory(records);
      const maxNumber=records.reduce((max,item)=>{const match=String(item.certificateNumber||"").match(/-(\\d+)$/);return match?Math.max(max,Number(match[1])):max;},0);
      setNextCertificateNumber(`${String(account.slice(2,6)).toUpperCase()}-${String(maxNumber+1).padStart(5,"0")}`);
    } catch(error) { setNotice(error.message || "Could not load certificate history."); }
  }
  async function loadEmailCertificates(token=studentToken) {
    if (!token) return;
    const response=await fetch(API_URL.replace(/\/$/,"")+"/api/student/certificates",{headers:{Authorization:"Bearer "+token}});
    const payload=await response.json().catch(()=>({}));
    if (!response.ok) throw new Error(payload.error || "Could not load student certificates.");
    const contract=getReadContract();
    const records=[];
    // Keep saved certificates visible if the public RPC temporarily fails.
    for(const item of (payload.certificates||[])) {
      let record={certificateId:item.certificateId,universityName:item.universityName,verificationUrl:item.verificationUrl,documentUrl:item.documentUrl,issuedAt:item.issuedAt?new Date(item.issuedAt).toLocaleString():"",revoked:false,chainStatus:"Pending check"};
      try {
        const cert=await contract.getCertificate(item.certificateId);
        const university=await contract.getUniversity(cert.issuer);
        record={...record,universityId:cert.universityId,universityName:university.name||item.universityName,recipient:cert.recipient,issuer:cert.issuer,documentHash:cert.documentHash,ipfsCid:cert.ipfsCid,issuedAt:new Date(Number(cert.issuedAt)*1000).toLocaleString(),revoked:cert.revoked,chainStatus:"Verified on-chain"};
      } catch(error) {
        console.warn("Could not refresh on-chain status for certificate", item.certificateId, error);
      }
      records.push(record);
    }
    setEmailCertificates(records.sort((a,b)=>new Date(b.issuedAt)-new Date(a.issuedAt)));
    if(records.some(record=>record.chainStatus==="Pending check")) setNotice("Your saved certificates are shown. Blockchain status could not be refreshed right now; try again shortly.");
  }

  async function resendStudentPassword() {
    if (!studentEmail.trim()) { setNotice("Enter your student email address first."); return; }
    setBusy(true); setNotice("");
    try {
      const response=await fetch(API_URL.replace(/\/$/,"")+"/api/student/resend-password",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:studentEmail.trim().toLowerCase()})});
      const payload=await response.json().catch(()=>({}));
      if (!response.ok) throw new Error(payload.error || "Could not send a password email.");
      setNotice(payload.message || "If your account exists, a new password has been emailed.");
    } catch(error) { setNotice(error.message || "Could not send a password email."); }
    finally { setBusy(false); }
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
    if (!isAddress(account)) { setNotice("Enter a valid public wallet address."); return; }
    setBusy(true); setNotice("");
    try {
      const contract=getReadContract();
      const filter=contract.filters.CertificateIssued(null,null,account);
      const latest=await readProvider.getBlockNumber();
      const events=[];
      // This contract was deployed on Sepolia at block 12175745.
      // Scan only this contract's lifetime, in small ranges; adaptively shrink
      // the range if the configured RPC rejects a getLogs request.
      const deploymentBlock=Math.max(0, Number(import.meta.env.VITE_CONTRACT_START_BLOCK || 12175745));
      let toBlock=latest;
      while(toBlock>=deploymentBlock) {
        let span=2000;
        let chunk;
        while(true) {
          const fromBlock=Math.max(deploymentBlock,toBlock-span+1);
          try {
            chunk=await contract.queryFilter(filter,fromBlock,toBlock);
            toBlock=fromBlock-1;
            break;
          } catch(error) {
            if(span<=100) throw error;
            span=Math.max(100,Math.floor(span/2));
          }
        }
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
      setStudentCertificates(records.sort((a,b)=>new Date(b.issuedAt)-new Date(a.issuedAt)));
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
      setNotice(`University registration submitted: ${tx.hash}. Waiting for confirmation…`);
      await tx.wait();
      setUniversityWalletInput(""); setUniversityCodeInput(""); setUniversityNameInput("");
      setNotice("University authorized successfully. It can now issue certificates from its wallet.");
    } catch(error) { setNotice(error.shortMessage || error.reason || error.message || "University registration failed."); }
    finally { setBusy(false); }
  }

  async function universityAuth(event){
    event.preventDefault();setBusy(true);setNotice("");
    try{
      const {account,signer}=await getWalletSigner();
      if(universityRegisterMode){
        const ch=await fetch(API_URL.replace(/\/$/,"")+"/api/university/auth/challenge",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({wallet:account})});
        const challenge=await ch.json();if(!ch.ok)throw new Error(challenge.error);
        const name=String(universityAccount?.name||"").trim(),code=String(universityAccount?.code||"").trim().toUpperCase();
        const message="CertiChain University Account Registration\nWallet: "+account.toLowerCase()+"\nEmail: "+universityEmail.trim().toLowerCase()+"\nNonce: "+challenge.nonce;
        const signature=await signer.signMessage(message);
        const r=await fetch(API_URL.replace(/\/$/,"")+"/api/university/auth/register",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:universityEmail,password:universityPassword,universityName:name,universityCode:code,wallet:account,signature,nonce:challenge.nonce})});
        const d=await r.json();if(!r.ok)throw new Error(d.error);setNotice("Verification email sent. Verify your university email before signing in.");
      }else{
        const r=await fetch(API_URL.replace(/\/$/,"")+"/api/university/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:universityEmail,password:universityPassword})});
        const d=await r.json();if(!r.ok)throw new Error(d.error);
        if(d.university.wallet.toLowerCase()!==account.toLowerCase())throw new Error("Connect the wallet registered to this university.");
        sessionStorage.setItem("certichain-university-token",d.token);setUniversityToken(d.token);setUniversityAccount(d.university);setUniversityTemplates(d.university.templates||[]);setProfileName(d.university.name);setProfileCode(d.university.code);setNotice("University signed in.");
      }
    }catch(e){setNotice(e.shortMessage||e.message||"University authentication failed.");}finally{setBusy(false);}
  }
  async function saveUniversityProfile(e){e.preventDefault();try{const r=await fetch(API_URL.replace(/\/$/,"")+"/api/university/account",{method:"PATCH",headers:{"Content-Type":"application/json",Authorization:"Bearer "+universityToken},body:JSON.stringify({universityName:profileName,universityCode:profileCode})});const d=await r.json();if(!r.ok)throw new Error(d.error);setUniversityAccount(d.university);setNotice("Profile updated.");}catch(e){setNotice(e.message);}}
  async function saveUniversityTemplate(e){e.preventDefault();if(!templateFile)return;setBusy(true);try{const form=new FormData();form.append("file",templateFile);const up=await fetch(API_URL.replace(/\/$/,"")+"/api/ipfs/upload",{method:"POST",body:form});const ud=await up.json();if(!up.ok)throw new Error(ud.error);const r=await fetch(API_URL.replace(/\/$/,"")+"/api/university/templates",{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+universityToken},body:JSON.stringify({name:templateName,cid:ud.cid,mimeType:templateFile.type,active:universityTemplates.length===0})});const d=await r.json();if(!r.ok)throw new Error(d.error);setUniversityTemplates(d.templates);setTemplateName("");setTemplateFile(null);setNotice("Template uploaded and saved.");}catch(e){setNotice(e.message);}finally{setBusy(false);}}
  async function loadTemplateForIssuance(id){
    const template=universityTemplates.find(item=>String(item._id)===String(id));if(!template)return;
    setBusy(true);
    try{const response=await fetch(template.url);if(!response.ok)throw new Error("Could not download this template from IPFS.");const blob=await response.blob();const ext=template.mimeType==="application/pdf"?"pdf":template.mimeType==="image/png"?"png":"jpg";setFile(new File([blob],template.name+"."+ext,{type:template.mimeType}));setNotice("Template selected. Add student details and issue the certificate.");}
    catch(error){setNotice(error.message);}finally{setBusy(false);}
  }
  async function activateTemplate(id){try{const r=await fetch(API_URL.replace(/\/$/,"")+`/api/university/templates/${id}/active`,{method:"PATCH",headers:{Authorization:"Bearer "+universityToken}});const d=await r.json();if(!r.ok)throw new Error(d.error);setUniversityTemplates(d.templates);setNotice("Active template changed.");}catch(e){setNotice(e.message);}}
  async function changeUniversityPassword(e){e.preventDefault();try{const r=await fetch(API_URL.replace(/\/$/,"")+"/api/university/password",{method:"PATCH",headers:{"Content-Type":"application/json",Authorization:"Bearer "+universityToken},body:JSON.stringify({currentPassword:currentUniversityPassword,newPassword:newUniversityPassword})});const d=await r.json();if(!r.ok)throw new Error(d.error);setCurrentUniversityPassword("");setNewUniversityPassword("");setNotice("Password updated.");}catch(e){setNotice(e.message);}}
  function logoutUniversity(){sessionStorage.removeItem("certichain-university-token");setUniversityToken("");setUniversityAccount(null);setUniversityTemplates([]);setNotice("Signed out.");}
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
    const verifyToken=params.get("university_verify");
    if(verifyToken){fetch(API_URL.replace(/\/$/,"")+"/api/university/auth/verify-email",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token:verifyToken})}).then(async response=>{const data=await response.json();if(!response.ok)throw new Error(data.error||"Email verification failed.");setNotice(data.message||"University email verified.");window.history.replaceState({}, "", window.location.pathname);}).catch(error=>setNotice(error.message));}
    if (cert) {setPage("verify");setLookupId(cert);window.setTimeout(()=>verify(cert),0)}
  },[]);
  useEffect(()=>{if(universityToken){loadUniversityAccount().catch(error=>{setNotice(error.message);logoutUniversity();});}},[universityToken]);

  const navItems=[["verify","Public verification"],["student","Student portal"],["admin","Admin portal"]];
  const openStudent=async()=>{setPage("student")};
  const openAdmin=async()=>{setPage("admin");if(wallet) await checkAdmin(wallet)};
  const copyShare=async(url)=>{try{await navigator.clipboard.writeText(url);setNotice("Share link copied.")}catch{setNotice("Browser clipboard permission was not granted.")}};

  return <main className="app-shell">
    <nav className="topbar">
      <a className="brand" href="/" onClick={e=>{e.preventDefault();setPage("verify")}}>Certi<span>Chain</span><small>BLOCKCHAIN CREDENTIALS</small></a>
      <div className="nav-actions">
        <span className="network"><i/> {networkName}</span>
        <button className="button button-theme" onClick={()=>setTheme(t=>t==="light"?"dark":"light")}>{theme==="light"?"☾ Dark":"☀ Light"}</button>
        {page!=="student" && <button className="button button-outline" onClick={connectWallet}>{wallet?short(wallet):"Connect wallet"}</button>}
      </div>
    </nav>
    <div className="portal-nav" role="navigation" aria-label="Main sections">
      {navItems.map(([key,label])=><button key={key} className={page===key?"active":""} onClick={()=>key==="student"?openStudent():key==="admin"?openAdmin():setPage(key)}>{label}{key==="admin"&&<span>RESTRICTED</span>}</button>)}
    </div>

    {page==="verify" && <>
      <section className="hero">
        <div className="eyebrow"><span/> OPEN, INDEPENDENT VERIFICATION</div>
        <h1>Verify credentials.<br/><em>Trust the record.</em></h1>
        <p>Verify a certificate using its ID or document hash.</p>
        
      </section>
      <section className="workspace">
        <div className="panel">
          <div className="panel-heading"><div><div className="eyebrow">PUBLIC VERIFICATION</div><h2>Check a certificate</h2><p></p></div><div className="panel-icon">✓</div></div>
          
          <label htmlFor="certificate">Certificate ID / Document hash</label>
          <div className="input-row"><input id="certificate" value={lookupId} onChange={e=>setLookupId(e.target.value)} placeholder="0x + 64 hexadecimal characters"/><button className="button button-primary" onClick={()=>verify()} disabled={busy}>{busy?"Checking…":"Verify certificate"}</button></div>
          {result && <div className="result-card">
            <div className="status-line"><span className={result.status==="VALID"?"status status-valid":"status status-revoked"}>{result.status==="VALID"?"✓ VALID CERTIFICATE":"✕ REVOKED CERTIFICATE"}</span><span className="muted">VERIFICATION RESULT</span></div>
            <div className="details-grid"><div><small>Certificate ID</small><strong>{short(result.certificateId)}</strong></div><div><small>University</small><strong>{result.universityName || short(result.universityId)}</strong></div><div><small>Issued at</small><strong>{result.issuedAt}</strong></div><div><small>Revocation status</small><strong>{result.revoked?"Revoked":"Not revoked"}</strong></div></div>
            
            <div className="cid-row"><span>IPFS certificate file</span><a href={ipfsUrl(result.ipfsCid)} target="_blank" rel="noreferrer">View / download document ↗</a></div>
            
            {qr && <div className="qr-area"><img src={qr} alt="Certificate verification QR code"/><div><b>Share public verification</b><p>Share this secure link or QR code so anyone can independently verify the record.</p><button className="button button-outline" onClick={()=>copyShare(shareUrl)}>Copy verification link</button></div></div>}
            {wallet.toLowerCase()===result.issuer.toLowerCase() && !result.revoked && <button className="button button-danger" onClick={revoke} disabled={busy}>Revoke certificate</button>}
          </div>}
        </div>
      </section>
    </>}

    {page==="student" && <>
      <section className="hero portal-hero"><div className="eyebrow">STUDENT PORTAL</div><h1>Your certificates.</h1></section>
      <section className="workspace"><div className="panel">
        <div className="panel-heading"><div><h2>My certificates</h2></div><div className="panel-icon">▤</div></div>
        <div className="student-login">
          <h3>Sign in</h3>
          {studentToken ? <div className="student-wallet"><span>Signed in as</span><strong>{studentAccountEmail}</strong><button className="button button-outline" onClick={()=>loadEmailCertificates()} disabled={busy}>Refresh certificates</button><button className="button button-outline" onClick={logoutStudent}>Sign out</button></div> : <form onSubmit={loginStudent}>
            <label htmlFor="student-email">Email address</label><input id="student-email" type="email" value={studentEmail} onChange={e=>setStudentEmail(e.target.value)} placeholder="student@example.com" autoComplete="email" required/>
            <label htmlFor="student-password">Password</label><input id="student-password" type="password" value={studentPassword} onChange={e=>setStudentPassword(e.target.value)} placeholder="Enter your password" autoComplete="current-password" required/>
            <button className="button button-primary button-wide" type="submit" disabled={busy}>{busy?"Signing in…":"Sign in to student portal"}</button>
            <button className="button button-outline button-wide" type="button" onClick={resendStudentPassword} disabled={busy}>Forgot password? Resend password</button>
          </form>}
          {studentToken && <div className="certificate-list">
            {emailCertificates.map(cert=><article className="student-cert" key={cert.certificateId}>
              <div className="status-line"><span className={cert.revoked?"status status-revoked":"status status-valid"}>{cert.revoked?"REVOKED":"VERIFIED CREDENTIAL"}</span><span className="muted">{cert.issuedAt}</span></div>
              <h3>Certificate {short(cert.certificateId)}</h3><p>{cert.universityName || "University"}</p>
              
              <div className="student-cert-actions"><a className="button button-primary" href={ipfsUrl(cert.ipfsCid)} target="_blank" rel="noreferrer">View / download</a><button className="button button-outline" onClick={()=>{setLookupId(cert.certificateId);setPage("verify");verify(cert.certificateId)}}>Verify</button></div>
            </article>)}
            {!emailCertificates.length && <div className="empty-state">No certificates are linked to this email address yet.</div>}
          </div>}
        </div>
        <div className="student-wallet-actions">
          <h3>Search by public wallet</h3><p>Optional · No wallet connection required</p>
          <input aria-label="Public wallet address" value={publicWalletLookup} onChange={e=>setPublicWalletLookup(e.target.value)} placeholder="0x wallet address"/>
          <button className="button button-outline" onClick={()=>loadStudentCertificates(publicWalletLookup)} disabled={busy || !isAddress(publicWalletLookup)}>Find certificates</button>
        </div>
        <div className="certificate-list">
          {studentCertificates.map(cert=><article className="student-cert" key={cert.certificateId}>
            <div className="status-line"><span className={cert.revoked?"status status-revoked":"status status-valid"}>{cert.revoked?"REVOKED":"VERIFIED CREDENTIAL"}</span><span className="muted">{cert.issuedAt}</span></div>
            <h3>Certificate {short(cert.certificateId)}</h3><p>{cert.universityName || "University"} · {cert.certificateNumber || ""}</p>
            <div className="student-cert-actions"><a className="button button-primary" href={ipfsUrl(cert.ipfsCid)} target="_blank" rel="noreferrer">View / download</a><button className="button button-outline" onClick={()=>{setLookupId(cert.certificateId);setPage("verify");verify(cert.certificateId)}}>Verify</button></div>
          </article>)}
          {!studentCertificates.length && <div className="empty-state">Enter a public wallet address to search.</div>}
        </div>
      </div></section>
    </>}

    {page==="admin" && <>
      <section className="hero portal-hero"><div className="eyebrow">ISSUER PORTAL</div><h1>University dashboard.</h1></section>
      <section className="workspace"><div className="panel">
        <div className="panel-heading"><div><div className="eyebrow">DASHBOARD</div><h2>Manage institutions</h2></div><div className="panel-icon">⌑</div></div>
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
          {!universityToken ? <div className="university-auth-card"><h3>{universityRegisterMode?"Register university account":"University sign in"}</h3><p>Connect the authorized university wallet and use your official email.</p><form onSubmit={universityAuth}><label>Official university email</label><input type="email" value={universityEmail} onChange={e=>setUniversityEmail(e.target.value)} required/><label>Password (minimum 10 characters)</label><input type="password" minLength={10} value={universityPassword} onChange={e=>setUniversityPassword(e.target.value)} required/>{universityRegisterMode&&<><label>University name</label><input value={universityAccount?.name||""} onChange={e=>setUniversityAccount(v=>({...v,name:e.target.value}))} required/><label>University code</label><input value={universityAccount?.code||""} onChange={e=>setUniversityAccount(v=>({...v,code:e.target.value.toUpperCase()}))} required/></>}<button className="button button-primary button-wide" disabled={busy}>{universityRegisterMode?"Create account":"Sign in"}</button></form><button className="button button-outline button-wide" onClick={()=>setUniversityRegisterMode(v=>!v)}>{universityRegisterMode?"Already registered? Sign in":"Create university account"}</button></div> : <>
          <div className="admin-authorized"><span>UNIVERSITY ACCOUNT</span><strong>{universityAccount?.name||universityProfile.name}</strong><button className="button button-outline" onClick={logoutUniversity}>Sign out</button></div>
          <div className="tabs university-tabs"><button type="button" className={universityTab==="templates"?"active":""} onClick={()=>setUniversityTab("templates")}>Templates</button><button type="button" className={universityTab==="profile"?"active":""} onClick={()=>setUniversityTab("profile")}>Profile</button><button type="button" className={universityTab==="issue"?"active":""} onClick={()=>setUniversityTab("issue")}>Issue certificate</button><button type="button" className={universityTab==="history"?"active":""} onClick={()=>{setUniversityTab("history");loadUniversityHistory(wallet)}}>Certificate history</button></div>
          {universityTab==="templates"&&<div className="university-settings"><h3>Certificate templates</h3><p>Upload your blank certificate PDF/image with signatures already included.</p><form onSubmit={saveUniversityTemplate}><label>Template name</label><input value={templateName} onChange={e=>setTemplateName(e.target.value)} required placeholder="BS Computer Science"/><label>Blank certificate</label><input type="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" onChange={e=>setTemplateFile(e.target.files?.[0]||null)} required/><button className="button button-primary" disabled={busy}>Upload template</button></form>{universityTemplates.map(t=><article className="history-item" key={t._id}><div><strong>{t.name}</strong><small>{t.active?"Active":"Available"}</small></div><div className="history-actions"><a href={t.url} target="_blank" rel="noreferrer">Preview</a>{!t.active&&<button className="button button-outline" onClick={()=>activateTemplate(t._id)}>Use this</button>}</div></article>)}</div>}
          {universityTab==="profile"&&<div className="university-settings"><h3>University profile</h3><form onSubmit={saveUniversityProfile}><label>Name</label><input value={profileName} onChange={e=>setProfileName(e.target.value)} required/><label>University code</label><input value={profileCode} onChange={e=>setProfileCode(e.target.value.toUpperCase())} required/><button className="button button-primary">Save profile</button></form><form onSubmit={changeUniversityPassword}><h3>Change password</h3><label>Current password</label><input type="password" value={currentUniversityPassword} onChange={e=>setCurrentUniversityPassword(e.target.value)} required/><label>New password</label><input type="password" minLength={10} value={newUniversityPassword} onChange={e=>setNewUniversityPassword(e.target.value)} required/><button className="button button-outline">Update password</button></form><p>Official email: {universityAccount?.email||universityEmail}</p></div>}
          {universityTab==="issue" && <form onSubmit={issue}>
            <label>Certificate number</label><div className="generated-number"><strong>{nextCertificateNumber || "Generating…"}</strong><span>Automatically assigned · Locked</span></div>
            <label htmlFor="recipient-email">Student email</label><input id="recipient-email" type="email" value={recipientEmail} onChange={e=>setRecipientEmail(e.target.value)} placeholder="student@example.com" autoComplete="email" required/>
            <label htmlFor="recipient">Student wallet <span className="optional-mark">OPTIONAL</span></label><input id="recipient" value={recipient} onChange={e=>setRecipient(e.target.value)} placeholder="0x…"/>
            {universityTemplates.length>0&&<><label htmlFor="template-select">Choose saved certificate template</label><select id="template-select" defaultValue="" onChange={e=>loadTemplateForIssuance(e.target.value)}><option value="" disabled>Select a template</option>{universityTemplates.map(t=><option key={t._id} value={t._id}>{t.name}{t.active?" (Active)":""}</option>)}</select></>}\n            <label htmlFor="document">Certificate file (or replace selected template)</label><input id="document" type="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" onChange={e=>setFile(e.target.files?.[0]||null)} required/>
            {file && <p className="file-note">{file.name} · {(file.size/1024/1024).toFixed(2)} MB</p>}
            <button className="button button-primary button-wide" type="submit" disabled={busy}>{busy?"Processing…":"Issue certificate"}</button>
          </form>}
          {universityTab==="history" && <section className="university-history"><div className="history-toolbar"><h3>Issued certificates <span>{universityHistory.length}</span></h3><select aria-label="Sort certificate history" value={historySort} onChange={e=>setHistorySort(e.target.value)}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="number-asc">Certificate number A–Z</option><option value="number-desc">Certificate number Z–A</option></select></div>
            {universityHistory.length ? [...universityHistory].sort((a,b)=>{if(historySort==="oldest") return new Date(a.issuedAt)-new Date(b.issuedAt);if(historySort==="number-asc") return String(a.certificateNumber).localeCompare(String(b.certificateNumber),undefined,{numeric:true});if(historySort==="number-desc") return String(b.certificateNumber).localeCompare(String(a.certificateNumber),undefined,{numeric:true});return new Date(b.issuedAt)-new Date(a.issuedAt);}).map(cert=><article className="history-item" key={cert.certificateId}><div><strong>{cert.certificateNumber}</strong><small>{cert.issuedAt?new Date(cert.issuedAt).toLocaleString():""}</small></div><div className="history-actions"><a href={cert.documentUrl} target="_blank" rel="noreferrer">Document</a><a href={cert.verificationUrl} target="_blank" rel="noreferrer">Verify</a></div></article>) : <div className="empty-state">No certificates issued yet.</div>}</section>}          </> }\n        </> : <div className="access-denied"><strong>Access restricted</strong><p>This wallet is not an active registered university issuer or the platform owner.</p><button className="button button-outline" onClick={()=>checkAdmin(wallet)}>Check authorization again</button></div>}
      </div></section>
    </>}

    {notice && (/Uploading|Waiting for|Searching blockchain|Confirm the issuance transaction|Transaction submitted/i.test(notice) ? <div className="notice" role="status">{notice}</div> : <div className="alert-backdrop" role="presentation" onClick={()=>setNotice("")}><section className="custom-alert" role="alertdialog" aria-modal="true" aria-label="Notification" onClick={event=>event.stopPropagation()}><div className={/failed|error|invalid|denied|not found|unavailable|could not|rejected|expired|required|must be|not configured/i.test(notice)?"alert-icon alert-error":"alert-icon"}>{/failed|error|invalid|denied|not found|unavailable|could not|rejected|expired|required|must be|not configured/i.test(notice)?"!":"✓"}</div><h3>{/failed|error|invalid|denied|not found|unavailable|could not|rejected|expired|required|must be|not configured/i.test(notice)?"Something went wrong":"Notification"}</h3><p>{notice}</p><button className="button button-primary" onClick={()=>setNotice("")}>Got it</button></section></div>)}
    <footer className="footer"><span>CertiChain © 2026</span></footer>
  </main>;
}
