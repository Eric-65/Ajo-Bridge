# Ajo Bridge — 90-second demo video script

Record at phone width (390 px) or with the browser's device toolbar on; the app is mobile first. Everything in parts 1–4 works in demo mode with no wallet. Part 5 needs the deployed contract and is optional.

| Time | On screen | Say |
| --- | --- | --- |
| 0:00–0:10 | Landing page. The ring animates: coins flow into the pot, then to one member. | "This is ajo — a savings circle. Everyone pays in each round, one member takes the pot. Millions of people save this way. It breaks in two places: the collector runs, or the member paid first stops paying." |
| 0:10–0:22 | Scroll to **The promise** card, then **How it works → 01 LOCK**. | "Ajo Bridge puts the circle in a NEAR contract with no withdraw function. And to take an early slot you lock what you will still owe after you are paid. Slot one of five locks 80, the last slot locks 20." |
| 0:22–0:40 | **Circles → Balogun Market Traders**. Press **› CONTRIBUTE**. Then **Demo only: skip to the deadline**, then **› SETTLE ROUND NOW**. | "I'm slot five. I pay my 20. Ada was paid in round one and has now stopped paying. The deadline passes — anyone can settle. Her collateral is slashed, and Bayo still gets a full pot, in the same transaction." |
| 0:40–0:52 | **Walk-away test → › AUTO-PLAY**. Let it reach the ledger and the green verdict. | "Here is the whole attack, replayed by the same code the contract runs. Ada collects 99, loses 80 of collateral, ends at minus 0.80. Everyone else is made whole. That invariant is tested for every circle size and slot." |
| 0:52–1:04 | **Circles → Lagos to London Family**. Switch **Acting as** to `uncle.london`. Press **› VOUCH FOR FUNKE** and confirm. | "Funke can't lock 30 NEAR. Her uncle in London vouches for her. If she defaults, his stake goes first. Diaspora backs, home borrows." |
| 1:04–1:16 | Back on Balogun: **› PAY FROM ANY CHAIN**. Show the live quote for USDC on Base, the MAINNET and TESTNET labels. *(If recording the real transfer: get the deposit address, show the QR and the status tracker.)* | "And he doesn't need NEAR. NEAR Intents quotes USDC on Base, USDT on Tron or SOL, live, on mainnet." |
| 1:16–1:26 | **› ASK ALAJO → Who hasn't paid?** then tap **Pidgin** and ask again. | "Alajo, the AI coordinator, answers from the circle's state — in English, Pidgin or Yoruba. Its key can only settle rounds and post notes. It cannot move money." |
| 1:26–1:30 | Mint section: "We removed the collector." | "Ajo Bridge. Nobody runs with the pot." |

## Before recording

1. `npm run setup && npm run dev`, open `http://localhost:5173`.
2. Press **Reset demo** in the grey banner so the circles are in their starting state.
3. For 1:04–1:16 the 1Click API must be reachable; otherwise the drawer shows an error instead of a quote (it never fakes one).
4. For a real mainnet transfer use a tiny amount, your own mainnet account as recipient and your own address as the refund address.

## Optional part 5 — testnet (after deploying)

Connect Meteor Wallet (tap the status dot; it turns mint). Create a circle with a 2-minute round, join from two accounts, contribute, wait two minutes, run `node agent/alajo.js tick` and show the agent's `settle_round` and `post_note` transactions in the explorer.
