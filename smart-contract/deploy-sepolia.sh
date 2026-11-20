#!/usr/bin/env bash
set -euo pipefail

: "${SEPOLIA_RPC_URL:?Set SEPOLIA_RPC_URL in your shell or .env}"
: "${DEPLOYER_PRIVATE_KEY:?Set DEPLOYER_PRIVATE_KEY in your shell or .env}"
: "${ETHERSCAN_API_KEY:?Set ETHERSCAN_API_KEY in your shell or .env}"

cd "$(dirname "$0")"
forge script script/Deploy.s.sol:Deploy \
  --rpc-url "$SEPOLIA_RPC_URL" \
  --private-key "$DEPLOYER_PRIVATE_KEY" \
  --broadcast \
  --verify \
  --verifier etherscan \
  --etherscan-api-key "$ETHERSCAN_API_KEY" \
  -vvvv

echo
echo "Copy the deployed contract address from the output."
echo "Set VITE_CONTRACT_ADDRESS to that address in the Vercel frontend project."
