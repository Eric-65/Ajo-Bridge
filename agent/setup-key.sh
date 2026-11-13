#!/usr/bin/env bash
# Give the Alajo agent the only key it ever uses: a FUNCTION-CALL access key.
#
#   ALAJO_ACCOUNT_ID=alajo.you.testnet AJO_CONTRACT_ID=ajobridge.you.testnet ./agent/setup-key.sh
#
# What this key can do, enforced by the NEAR protocol itself (not by our code):
#   - call ONLY settle_round, post_note and finalize
#   - ONLY on the Ajo Bridge contract
#   - with ZERO attached deposit (function-call keys cannot attach NEAR or send transfers)
#   - spending at most 1 NEAR of the agent's own balance on gas
#
# None of those three methods takes an amount or a destination, so the agent
# cannot move, redirect or withdraw circle funds even if its key leaks.
#
# The new key pair is printed once. Put the private key in .env as
# ALAJO_PRIVATE_KEY (never commit it). For extra safety you can afterwards
# delete the agent account's full-access key with `near account delete-keys`.
set -euo pipefail

: "${ALAJO_ACCOUNT_ID:?set ALAJO_ACCOUNT_ID}"
: "${AJO_CONTRACT_ID:?set AJO_CONTRACT_ID}"
NETWORK="${NEAR_NETWORK:-testnet}"

near account add-key "$ALAJO_ACCOUNT_ID" grant-function-call-access \
  --allowance '1 NEAR' \
  --contract-account-id "$AJO_CONTRACT_ID" \
  --function-names 'settle_round, post_note, finalize' \
  autogenerate-new-keypair print-to-terminal \
  network-config "$NETWORK" sign-with-keychain send

echo
echo "Verify on chain (look for FunctionCall permission with exactly three method names):"
near account list-keys "$ALAJO_ACCOUNT_ID" network-config "$NETWORK" now
