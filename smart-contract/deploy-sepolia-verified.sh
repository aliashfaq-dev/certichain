#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
if [ -f "$ROOT/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi

: "${SEPOLIA_RPC_URL:?Add SEPOLIA_RPC_URL to smart-contract/.env}"
: "${PRIVATE_KEY:?Add PRIVATE_KEY to smart-contract/.env}"
: "${ETHERSCAN_API_KEY:?Add ETHERSCAN_API_KEY to smart-contract/.env}"

cd "$ROOT"
forge script script/Deploy.s.sol:Deploy \
  --rpc-url "$SEPOLIA_RPC_URL" \
  --private-key "$PRIVATE_KEY" \
  --broadcast \
  --verify \
  --verifier etherscan \
  --etherscan-api-key "$ETHERSCAN_API_KEY"
