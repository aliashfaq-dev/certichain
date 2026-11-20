#!/usr/bin/env bash
set -euo pipefail

: "${ETHERSCAN_API_KEY:?Set ETHERSCAN_API_KEY in your shell or .env}"
: "${CONTRACT_ADDRESS:?Set CONTRACT_ADDRESS to the deployed Sepolia contract address}"

cd "$(dirname "$0")"
forge verify-contract \
  --chain-id 11155111 \
  --watch \
  --etherscan-api-key "$ETHERSCAN_API_KEY" \
  "$CONTRACT_ADDRESS" \
  src/CertificateVerification.sol:CertificateVerification
