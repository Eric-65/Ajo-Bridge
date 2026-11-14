#!/usr/bin/env bash
# Deploy Ajo Bridge to NEAR testnet from CI (.github/workflows/deploy-testnet.yml).
#
# 1. Create a fresh account with NEAR's testnet faucet (free testnet NEAR).
# 2. Top it up from extra faucet accounts if it cannot pay for the ~560 kB
#    contract's storage.
# 3. Deploy build/ajo_bridge.wasm and call init(owner, agent).
# 4. Check it with a view call.
# 5. If LOCK=true, delete the account's only full-access key: nobody can
#    change the contract's code after that, not even whoever ran this.
#
# Private keys never reach the log: they are masked, every CLI output is
# filtered, and ~/.near-credentials is wiped on exit.
set -euo pipefail

: "${GITHUB_RUN_ID:=local}"
NAME="${NAME_INPUT:-ajobridge-$GITHUB_RUN_ID}"
ID="$NAME.testnet"
OWNER="${OWNER_INPUT:-$ID}"
LOCK="${LOCK:-true}"
RPC="${NEAR_RPC_URL:-https://rpc.testnet.near.org}"
WASM="contract/build/ajo_bridge.wasm"
CREDS="$HOME/.near-credentials"

trap 'rm -rf "$CREDS"' EXIT
redact() { sed -E 's/ed25519:[1-9A-HJ-NP-Za-km-z]{60,}/ed25519:[redacted]/g'; }

[ -f "$WASM" ] || { echo "Missing $WASM: run npm run build:contract first" >&2; exit 1; }

balance() {
  curl -sS "$RPC" -H 'Content-Type: application/json' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"query\",\"params\":{\"request_type\":\"view_account\",\"finality\":\"final\",\"account_id\":\"$1\"}}" \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s);console.log(r.result?.amount??"0")})'
}
near_of() { node -e "console.log((Number(BigInt('$1')/10n**21n)/1000).toFixed(3))"; }

key_file() { find "$CREDS/testnet" -name '*.json' -path "*$1*" 2>/dev/null | head -1; }
mask_key() {
  local f; f="$(key_file "$1")"
  [ -n "$f" ] && node -e "const k=require('$f');if(k.private_key)console.log('::add-mask::'+k.private_key)"
  return 0
}

create() {
  echo "Creating $1 with the testnet faucet…"
  near account create-account sponsor-by-faucet-service "$1" autogenerate-new-keypair \
    save-to-legacy-keychain network-config testnet create 2>&1 | redact
  mask_key "$1"
  sleep 3
}

create "$ID"
echo "Balance of $ID: $(near_of "$(balance "$ID")") NEAR"

# The contract needs roughly 5.7 NEAR of storage; keep a margin.
NEED=$((7))
for i in 1 2 3; do
  have=$(balance "$ID")
  if node -e "process.exit(BigInt('$have') >= ${NEED}n*10n**24n ? 0 : 1)"; then break; fi
  helper="$NAME-fund$i.testnet"
  create "$helper"
  amount=$(node -e "const b=BigInt('$(balance "$helper")')-2n*10n**23n;console.log(b>0n?(Number(b/10n**21n)/1000).toFixed(3):'0')")
  echo "Moving $amount NEAR from $helper to $ID"
  near tokens "$helper" send-near "$ID" "$amount NEAR" network-config testnet sign-with-legacy-keychain send 2>&1 | redact
  sleep 3
done
echo "Balance before deploy: $(near_of "$(balance "$ID")") NEAR"

echo "Deploying $WASM to $ID (owner and agent: $OWNER)…"
near contract deploy "$ID" use-file "$WASM" \
  with-init-call init json-args "{\"owner\":\"$OWNER\",\"agent\":\"$OWNER\"}" \
  prepaid-gas '100 Tgas' attached-deposit '0 NEAR' \
  network-config testnet sign-with-legacy-keychain send 2>&1 | redact

sleep 3
echo "Checking get_config…"
near contract call-function as-read-only "$ID" get_config json-args '{}' network-config testnet now 2>&1 | redact

if [ "$LOCK" = "true" ]; then
  pk=$(node -e "console.log(require('$(key_file "$ID")').public_key)")
  echo "Locking: deleting the only full-access key $pk"
  near account delete-keys "$ID" public-keys "$pk" network-config testnet sign-with-legacy-keychain send 2>&1 | redact
  sleep 3
  echo "Keys left on $ID (should be none):"
  near account list-keys "$ID" network-config testnet now 2>&1 | redact
fi

echo "contract_id=$ID" >> "${GITHUB_OUTPUT:-/dev/null}"
{
  echo "## Ajo Bridge deployed to NEAR testnet"
  echo ""
  echo "| | |"
  echo "| --- | --- |"
  echo "| Contract | \`$ID\` |"
  echo "| Owner and agent | \`$OWNER\` |"
  echo "| Code locked (no full-access key) | $LOCK |"
  echo "| Explorer | https://testnet.nearblocks.io/address/$ID |"
  echo ""
  echo "Set \`VITE_AJO_CONTRACT_ID=$ID\` in Vercel and redeploy."
} >> "${GITHUB_STEP_SUMMARY:-/dev/stdout}"
echo "Done: $ID"
