#!/usr/bin/env bash
# Deploy Ajo Bridge to NEAR testnet with near-cli-rs (https://github.com/near/near-cli-rs).
#
#   PARENT=you.testnet ./contract/scripts/deploy.sh
#
# Creates two sub-accounts of PARENT (you must already be logged in to it with
# `near account import-account ...`), then deploys and initialises the contract:
#
#   ajobridge.<PARENT>   the contract
#   alajo.<PARENT>       the coordinator agent (see agent/setup-key.sh)
#
# Re-running after the accounts exist only redeploys the code (state is kept).
set -euo pipefail

: "${PARENT:?set PARENT to your testnet account, e.g. PARENT=you.testnet}"
NETWORK="${NEAR_NETWORK:-testnet}"
CONTRACT_ID="${AJO_CONTRACT_ID:-ajobridge.$PARENT}"
AGENT_ID="${ALAJO_ACCOUNT_ID:-alajo.$PARENT}"
WASM="$(cd "$(dirname "$0")/.." && pwd)/build/ajo_bridge.wasm"

[ -f "$WASM" ] || { echo "build first: npm --prefix contract run build" >&2; exit 1; }

exists() { near account view-account-summary "$1" network-config "$NETWORK" now >/dev/null 2>&1; }

if ! exists "$CONTRACT_ID"; then
  near account create-account fund-myself "$CONTRACT_ID" '6 NEAR' autogenerate-new-keypair save-to-keychain \
    sign-as "$PARENT" network-config "$NETWORK" sign-with-keychain send
  FRESH=1
fi
if ! exists "$AGENT_ID"; then
  near account create-account fund-myself "$AGENT_ID" '1 NEAR' autogenerate-new-keypair save-to-keychain \
    sign-as "$PARENT" network-config "$NETWORK" sign-with-keychain send
fi

if [ "${FRESH:-0}" = "1" ]; then
  near contract deploy "$CONTRACT_ID" use-file "$WASM" \
    with-init-call init json-args "{\"owner\":\"$PARENT\",\"agent\":\"$AGENT_ID\"}" \
    prepaid-gas '100 Tgas' attached-deposit '0 NEAR' \
    network-config "$NETWORK" sign-with-keychain send
else
  near contract deploy "$CONTRACT_ID" use-file "$WASM" without-init-call \
    network-config "$NETWORK" sign-with-keychain send
fi

echo
echo "Contract: $CONTRACT_ID"
echo "Agent:    $AGENT_ID"
echo "Add to .env:  AJO_CONTRACT_ID=$CONTRACT_ID  VITE_AJO_CONTRACT_ID=$CONTRACT_ID  ALAJO_ACCOUNT_ID=$AGENT_ID"
near contract call-function as-read-only "$CONTRACT_ID" get_config json-args '{}' network-config "$NETWORK" now
