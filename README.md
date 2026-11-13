# Ajo Bridge

A rotating savings circle (ajo / esusu / susu) on NEAR where nobody can run off with the money — not the collector, and not the member who gets paid first — and anyone, anywhere can contribute from any chain via NEAR Intents.

Built Nov 13–14, 2026 for **NEAR HACKATHON — Build Beyond Boundaries**. Track: **Real-World Money** (`realworld`); also fits Social Money (`social`) and AI Security & Defense (`security`).

> **Status: work in progress.** This README is updated at the end of every build phase. What exists today is listed under [Build status](#build-status); everything else is planned, not claimed.

## The problem

- **Collectors disappear with the pot.** In a traditional ajo one person (the *alajo*) holds everyone's money.
- **Early recipients stop paying.** The most common ROSCA failure: a member collects their payout early, then stops contributing. Existing onchain ajo apps use a flat deposit that covers one missed payment, not the whole remaining debt.
- **The payout order is a hidden loan.** Early slots get interest-free credit; late slots fund it and earn nothing.
- **Diaspora members cannot easily pay in.** People hold USDC on Base or Solana, or USDT on Tron — not one token on one chain.

## How Ajo Bridge fixes it

`n` members, contribution `C` per round, one payout per round. The member in slot `k` is paid in round `k`.

| Rule | Formula | Effect |
| --- | --- | --- |
| Slot-priced collateral | `R_k = (n − k) × C`, `S_k = max(C, R_k × coverageBps / 10000)` | Taking an early slot means locking what you will still owe after you are paid. |
| Vouching | anyone fills the part of `S_k` a member has not locked themselves (the member keeps at least 10% at stake) | "Diaspora backs, home borrows." The voucher's stake is slashed first. |
| Fair order fee | `F_k = R_k × orderFeeBps / 10000`, shared by weight `j − 1` for slot `j` | The longer you wait for your payout, the more you earn. |
| Settlement | after the deadline anyone calls `settle_round`; each missed `C` is taken from collateral | The round's recipient is paid even if somebody stops paying. |
| No custodian | there is no withdraw method | Money only leaves as a payout, a refund of your own deposit, a debt repayment or a fee share. |

### Worked example: `n = 5`, `C = 20`, coverage 100%, order fee 1%

| Slot `k` | Owes after payout `R_k` | Collateral `S_k` | Order fee `F_k` | Fee share | Net if honest |
| --- | --- | --- | --- | --- | --- |
| 1 | 80 | 80 | 0.80 | 0.00 | −0.80 |
| 2 | 60 | 60 | 0.60 | 0.20 | −0.40 |
| 3 | 40 | 40 | 0.40 | 0.40 | 0.00 |
| 4 | 20 | 20 | 0.20 | 0.60 | +0.40 |
| 5 | 0 | 20 | 0.00 | 0.80 | +0.80 |

If the slot-1 member collects 99.20 and walks away, their 80 collateral pays their four remaining contributions. Their net is `99.20 − 20 − 80 = −0.80`: walking away gains nothing, and every other member receives a full pot.

### Rules the contract adds to make the guarantee hold

Fuzzing the engine with random default patterns showed the headline formulas alone are not enough. Three small rules close the gaps:

1. **Payout top-up.** Before a recipient is paid, their collateral is refilled from their own payout up to `R_k × coverageBps / 10000`. Otherwise a member could miss early rounds to burn their collateral down, then collect the pot and leave.
2. **Own-round netting.** A recipient who skips their contribution in their own payout round is not slashed; the amount is simply netted out of the payout.
3. **Defaulters forfeit their fee share.** A member who misses any payment loses their share of the fee pool. Forfeited fees first repay anyone who was left short, then go to the members who never missed. A member in debt receives nothing until their creditors are repaid.

**Invariant (tested):** with `coverageBps = 10000`, a member who walks away after their payout never ends up with a net gain, and no other member is worse off than in a circle where everybody paid.

With a voucher, the *voucher* takes the loss in the walker's place — that is what vouching means — so the tested statement is that the walker and their vouchers together never gain. With coverage below 100% ("friends" mode) the group can be left short; the simulation shows exactly by how much.

## Try it

Requires Node.js 22 or newer on Linux or macOS (near-sdk-js does not build on Windows; use WSL).

**No install needed — math, engine and the offline demo:**

1. Run `npm run test:math` → see `# pass 34`, `# fail 0`. This includes the walk-away invariant for every `n` from 2 to 8 and every slot, plus 5,000 random default patterns.
2. Run `npm run demo` → see a round-by-round replay in the terminal ending with `✓ INVARIANT HOLDS: walking away earned nothing and every other member was made whole.` and a ledger where `ada` (the walker) has net `-0.80`.
3. Run `node scripts/demo.js --coverage 5000` → see `✗ The group was left short`, the walker's net `+39.20` and two members `left short 20.00`. This is why strangers should use 100% coverage.
4. Run `node scripts/demo.js --vouch 40` → see `uncle.london` slashed for the first two missed rounds before the walker's own collateral is touched.

Other demo options: `--n 6`, `--walker 2`, `--fee 250`, `--contribution 50`.

**The contract on a local NEAR sandbox (about 4 minutes, downloads the sandbox binary on first run):**

5. Run `npm run setup` once (installs `near-sdk-js` and `near-workspaces` in `contract/`).
6. Run `npm run test:contract` → see `10 tests passed`, including:
   - `INVARIANT on chain: slot 1 collects the pot and walks away — no gain, nobody else loses` (checked on real account balances),
   - `the Alajo agent: notes only, with a function-call key that cannot move money` (the protocol rejects `contribute`, attached deposits and transfers signed with the agent's key),
   - `custody: there is no way to pull money out of a circle`,
   - `gas and storage: a full 12-member circle where nobody ever pays stays within limits` (heaviest call about 47 Tgas of the 300 Tgas limit).
7. Run `npm test` → runs both suites.

## The contract

`contract/src/contract.js` (near-sdk-js, native NEAR). It is a thin shell around `shared/ajoEngine.js`: each method reads the caller, the attached deposit and the block time, runs the engine, saves the circle, then performs the transfers and logs the events the engine returned.

| Method | Who | Deposit | What it does |
| --- | --- | --- | --- |
| `create_circle` | anyone | storage fee | Sets members, contribution, round length, coverage, order fee. |
| `join({circle_id, slot})` | anyone | collateral | Takes an open slot. At least 10% of `S_k` must be the member's own; excess is refunded. Calling it again on your own slot adds collateral. |
| `vouch({circle_id, member})` | anyone | vouch amount | Fills the part of `S_k` the member has not put up. It never displaces the member's own stake. |
| `cancel_vouch`, `leave` | voucher / member | none | Before the start only. Full refund. |
| `contribute({circle_id})` | members | `C` | Pays the round. The last payment pays the recipient in the same transaction. |
| `settle_round({circle_id})` | anyone, after the deadline | none | Slashes missed contributions, pays the recipient. |
| `finalize({circle_id})` | anyone, after the last round | none | Refunds collateral, shares the fee pool. |
| `post_note({circle_id, text})` | the agent only | none | Attaches a reminder or report (max 280 characters). Moves no money. |
| `set_agent({agent})` | the owner only | none | Changes which account is the agent. This is the owner's only power. |
| views | — | — | `get_circle`, `get_member`, `quote_slot`, `list_circles`, `get_config`, `storage_fee` |

Every state change emits a NEP-297 log (`EVENT_JSON:{"standard":"ajo_bridge","version":"1.0.0","event":...}`): `circle_created`, `member_joined`, `vouched`, `vouch_cancelled`, `member_left`, `stake_added`, `circle_started`, `contributed`, `contribution_netted`, `voucher_slashed`, `member_slashed`, `round_paid`, `round_started`, `rounds_complete`, `circle_completed`, `note_posted`, `agent_changed`.

### Why nobody can run with the pot

- **No withdraw path.** The contract has no method that takes an amount or a destination. NEAR leaves only through the engine's transfer list: a payout to the round's recipient, a repayment to a short-paid member, a refund of the caller's own deposit, or a fee share.
- **The agent holds a function-call access key** limited to `settle_round`, `post_note` and `finalize` on this contract (`agent/setup-key.sh`). NEAR itself refuses to let such a key attach a deposit, send a transfer or call any other method. `finalize` is on the list so the agent can close a finished circle; like `settle_round` it takes no amount and no destination.
- **The owner can only change the agent.**

### Known limitations

- The account the contract is deployed to still has a full-access key, and whoever holds it could deploy different code. For real money that key should be deleted or handed to a DAO.
- Payouts are plain NEAR transfers. If a recipient deletes their account, their transfer bounces back to the contract and stays there.
- The storage fee is a flat estimate (8,000 bytes plus 2,500 per member). It covered a worst-case 12-member circle with room to spare in the sandbox test, but it is not metered per byte.
- v1 uses native NEAR for contributions and collateral, not a stablecoin.
- Members who miss a payment lose their whole fee share, even for one late round. Late payments are still accepted until somebody calls `settle_round`.

## Repository layout

```
shared/     ajoMath.js (formulas), ajoEngine.js (circle state machine), simulate.js, units.js + node:test tests
scripts/    demo.js — offline walk-away simulation
contract/   near-sdk-js contract (src/contract.js), sandbox tests (near-workspaces + ava), deploy script
web/        Vite + React app                                 (phases 3–7)
api/        serverless proxy: 1Click quote/status, Alajo     (phases 5–6)
agent/      setup-key.sh (function-call key for the agent); Alajo agent itself  (phase 6)
```

`shared/ajoEngine.js` is the single implementation of the circle rules. The contract executes it on chain; the tests, the terminal demo and the web app's demo mode run the same file locally.

## Build status

| Phase | Scope | State |
| --- | --- | --- |
| 1 | Shared math, engine, invariant tests, `npm run demo` | Done |
| 2 | near-sdk-js contract + 10 sandbox tests | Done |
| 2b | Deploy to testnet (`contract/scripts/deploy.sh`) | Script written, **not yet run** — no contract address yet |
| 3–7 | Web app, wallet, pay-from-any-chain, Alajo agent, simulator page | Not started |
| 8 | Full README, DEMO.md, Vercel deploy | Not started |

## Prior art

Rotating savings and credit associations (ROSCAs) are centuries old: ajo and esusu in Nigeria, susu in Ghana and the Caribbean, chit funds in India, tandas in Mexico. Onchain savings-circle projects exist on several chains; Ajo Bridge's code is written from scratch in this repository and does not copy or fork any of them. A fuller list of related projects and how this one differs will be added with the final README.

## AI tools disclosure

This project is built with the help of an AI coding agent (Claude Code), using the NEAR agent skills (`near/agent-skills`, pinned in `skills-lock.json`).

## License

MIT — see [LICENSE](LICENSE).
