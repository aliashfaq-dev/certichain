#!/usr/bin/env bash
set -euo pipefail

: "${SEPOLIA_RPC_URL:?Set SEPOLIA_RPC_URL in your shell or .env}"
: "${ETHERSCAN_API_KEY:?Set ETHERSCAN_API_KEY in your shell or .env}"
: "${CONTRACT_ADDRESS:?Set CONTRACT_ADDRESS to the deployed address}"

cd "$(dirname "$0")"
forge verify-contract \
  --chain sepolia \
  --watch \
  --verifier etherscan \
  --etherscan-api-key "$ETHERSCAN_API_KEY" \
  "$CONTRACT_ADDRESS" \
  src/CertificateVerification.sol:CertificateVerification
