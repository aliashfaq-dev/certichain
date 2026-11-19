# CertiChain — Blockchain-Based Certificate Verification

CertiChain is a certificate issuance and verification dApp. A university/admin wallet issues a certificate on an EVM blockchain; anyone can verify its on-chain status using its certificate ID. Revocation is recorded on-chain and remains auditable.

## Project structure

- `smart-contract/` — Solidity contract, Foundry tests and deployment script
- `backend/` — Express API starter (health check and future IPFS integration)
- `frontend/` — React + Vite starter UI

## Requirements

- Git, Node.js 20+, npm
- Foundry (`forge`, `cast`, `anvil`)
- MetaMask browser extension
- Sepolia ETH for testnet deployment
- Optional: Pinata account/API credentials for IPFS uploads

## Quick start

### 1. Smart contract

```bash
cd smart-contract
forge install foundry-rs/forge-std --no-commit
forge build
forge test
```

Create `smart-contract/.env` (never commit this file):

```env
SEPOLIA_RPC_URL=https://sepolia.infura.io/v3/YOUR_KEY
PRIVATE_KEY=YOUR_TEST_WALLET_PRIVATE_KEY
```

Deploy after configuring the RPC URL and funded test wallet:

```bash
source .env
forge script script/Deploy.s.sol:Deploy --rpc-url $SEPOLIA_RPC_URL --private-key $PRIVATE_KEY --broadcast
```

### 2. Backend

```bash
cd backend
cp .env.example .env
npm install
npm run dev
```

API health check: `GET http://localhost:4000/api/health`

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
```

Open the local URL printed by Vite.

## Current contract flow

1. The contract owner (university/admin) issues a certificate to a recipient wallet.
2. The contract stores a unique ID, recipient, document SHA-256 hash, IPFS CID and issue timestamp.
3. Anyone can query a certificate by ID.
4. Only the original issuer can revoke their certificate.
5. Verification must check both existence and revocation status. For document verification, hash the supplied PDF and compare it with the on-chain hash.

## Security and privacy

- Do not put student names, email addresses, CNICs, grades or other personal data on-chain.
- Public IPFS content is public. Do not upload confidential certificates unencrypted.
- Use a dedicated test wallet on Sepolia; never share or commit a real wallet private key.
- This repository is a learning starter, not an audited production system.

## Roadmap

- [x] Initial repository scaffold
- [ ] Complete contract tests and local deployment walkthrough
- [ ] Sepolia deployment and contract verification
- [ ] Pinata/IPFS upload flow
- [ ] Backend validation and persistence
- [ ] Admin issue/revoke dashboard
- [ ] Public QR/PDF verification page
- [ ] Production security review
