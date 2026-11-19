# CertiChain — Blockchain Certificate Verification

CertiChain is an EVM certificate dApp. An institution wallet issues credentials on-chain, documents are pinned to IPFS, and anyone can verify authenticity and revocation through a shareable URL or QR code.

## Features
- Solidity registry with unique IDs, SHA-256 document hashes, issuer/recipient wallets and revocation.
- Foundry tests and deployment script.
- Express + Pinata IPFS upload (JWT stays server-side), 10 MB PDF/PNG/JPG limit and rate limiting.
- React dashboard to issue/revoke with MetaMask and verify publicly without a wallet when RPC is configured.
- QR code and shareable verification URL.

## Requirements
Node.js 20+, npm, Foundry, MetaMask, Pinata API JWT, and Sepolia test ETH for public testnet deployment.

## Smart contract
```bash
cd smart-contract
forge install foundry-rs/forge-std --no-commit
forge build
forge test -vv
```

### Local Anvil deployment
Terminal 1: `anvil`

Terminal 2:
```bash
cd smart-contract
forge script script/Deploy.s.sol:Deploy --rpc-url http://127.0.0.1:8545 --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 --broadcast
```
The key above is a publicly known Anvil-only test key. Never use it on public networks or with real funds.

## Backend and IPFS
```bash
cd backend
npm install
cp .env.example .env
```
Create a Pinata API key at https://app.pinata.cloud/developers/api-keys and put its JWT in backend/.env:
```env
PORT=4000
FRONTEND_ORIGIN=http://localhost:5173
PINATA_JWT=your_pinata_jwt
```
Run `npm run dev`. Health: `http://localhost:4000/api/health`. Upload endpoint: `POST /api/ipfs/upload`, multipart field `file`. Do not expose the JWT to frontend code.

## Frontend
```bash
cd frontend
npm install
cp .env.example .env
```
Set frontend/.env after deploying locally:
```env
VITE_RPC_URL=http://127.0.0.1:8545
VITE_CONTRACT_ADDRESS=YOUR_DEPLOYED_CONTRACT_ADDRESS
VITE_CHAIN_ID=31337
VITE_API_URL=http://localhost:4000
```
Run `npm run dev`. Keep Anvil and backend running. Connect MetaMask to RPC http://127.0.0.1:8545, chain ID 31337, and use an Anvil test account only for local tests.

## Issue and verify
1. Connect the contract owner wallet.
2. Open **Issue certificate**, enter a unique certificate number, recipient wallet and PDF/image.
3. Browser calculates SHA-256; backend pins file to IPFS; MetaMask confirms the issue transaction.
4. The app shows the on-chain record, QR code and shareable link.
5. Anyone can open the link and verify using the configured public RPC.
6. The original issuer can connect and revoke; revocation remains auditable on-chain.

Certificate ID is `keccak256(UTF8(certificateNumber))`. Retain the original certificate number. To check a presented document, calculate its SHA-256 and compare it with on-chain `documentHash`.

## Sepolia
Use a dedicated test wallet. Store RPC URL and private key only in a local untracked environment file; never commit or send a private key. Fund with Sepolia test ETH, deploy using Foundry, then set frontend `VITE_RPC_URL`, `VITE_CONTRACT_ADDRESS` and `VITE_CHAIN_ID=11155111`.

## Security
- Never put student names, CNICs, emails, grades or other personal data on-chain.
- Public IPFS content is public. Do not upload confidential certificates unless encrypted first and key management is separately designed.
- Keep Pinata JWT only in backend environment variables.
- Never commit wallet keys, seed phrases or .env files.
- Educational starter only; not professionally audited.
