# Sepolia deployment and Etherscan verification

The local Anvil network (chain ID 31337) is for development only. Its contract addresses cannot be verified on Etherscan. Deploy to Sepolia (chain ID 11155111) to publish the source code on Sepolia Etherscan.

## 1. Prepare secrets locally

Copy `.env.sepolia.example` to `.env` in this folder and fill in:
- `SEPOLIA_RPC_URL`: your Sepolia RPC endpoint
- `PRIVATE_KEY`: a test-only deployer wallet private key funded with Sepolia ETH
- `ETHERSCAN_API_KEY`: your Etherscan API key

The `.env` file is ignored by Git. Never commit it or paste its values into chat. Do not use a wallet containing real funds.

## 2. Deploy and verify in one command

From Git Bash:
```bash
cd /c/Users/user/Downloads/certichain/smart-contract
bash deploy-sepolia-verified.sh
```

Foundry broadcasts the deployment and submits the source for verification. On success, copy the deployed contract address from the terminal output.

## 3. Configure the website for Sepolia

In `frontend/.env`, set:
```env
VITE_RPC_URL=YOUR_SEPOLIA_RPC_URL
VITE_CONTRACT_ADDRESS=YOUR_NEW_SEPOLIA_CONTRACT_ADDRESS
VITE_CHAIN_ID=11155111
VITE_API_URL=http://localhost:4000
```
Restart the Vite dev server after changing environment variables. In MetaMask, select Sepolia. The dashboard then shows a **View on Etherscan** link for the deployed contract.

## 4. Verify a contract that was already deployed

If you already deployed to Sepolia without the `--verify` flag, put the address in `CONTRACT_ADDRESS` in your shell, export `ETHERSCAN_API_KEY`, then run:
```bash
CONTRACT_ADDRESS=0xYourSepoliaContractAddress bash verify-sepolia.sh
```

The helper uses the exact source path and compiler/optimizer settings from `foundry.toml` (Solidity 0.8.24, optimizer enabled, 200 runs). The contract has no constructor arguments.

Verification is a Foundry/CI task, not a browser action: the Etherscan API key must stay on your machine/server and must never be exposed in the frontend.
