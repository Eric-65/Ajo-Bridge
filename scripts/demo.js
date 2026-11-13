#!/usr/bin/env node
/**
 * npm run demo — offline walk-away simulation.
 *
 * Five members save 20 NEAR per round. The member who is paid FIRST collects
 * the pot and disappears. The script replays every round through the same
 * engine the contract runs (shared/ajoEngine.js) and prints who ends up where.
 *
 *   node scripts/demo.js                       strangers mode, slot 1 walks
 *   node scripts/demo.js --coverage 5000       friends mode (50% coverage)
 *   node scripts/demo.js --walker 2 --n 6 --fee 250
 *   node scripts/demo.js --vouch 40            a diaspora backer puts up 40 NEAR for the walker
 */

import { slotTable, walkAwayPayoff } from '../shared/ajoMath.js';
import { simulateWalkAway } from '../shared/simulate.js';
import { formatNear, parseNear } from '../shared/units.js';

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

const n = Number(option('n', 5));
const contribution = parseNear(option('contribution', '20'));
const coverageBps = Number(option('coverage', 10000));
const orderFeeBps = Number(option('fee', 100));
const walkerSlot = Number(option('walker', 1));
const vouchAmount = option('vouch', null);

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code) => (text) => (useColor ? `\x1b[${code}m${text}\x1b[0m` : String(text));
const mint = paint('38;2;82;255;154');
const red = paint('38;2;255;90;90');
const dim = paint('2');
const bold = paint('1');

const N = (amount) => formatNear(amount);
const signed = (amount) => (amount > 0n ? `+${N(amount)}` : N(amount));
const pad = (text, width) => String(text).padEnd(width);
const padLeft = (text, width) => String(text).padStart(width);
const rule = (title) => console.log(`\n${bold(`── ${title} `.padEnd(78, '─'))}`);

const terms = { n, contribution, coverageBps, orderFeeBps };
const vouches = vouchAmount ? [{ slot: walkerSlot, voucher: 'uncle.london', amount: parseNear(vouchAmount) }] : [];
const sim = simulateWalkAway({ ...terms, walkerSlot, vouches });
const walker = sim.walker;

console.log(bold('\nAJO BRIDGE — walk-away simulation (offline, same engine as the contract)'));
console.log(`${n} members · ${N(contribution)} NEAR per round · coverage ${coverageBps / 100}% · order fee ${orderFeeBps / 100}%`);
console.log(`${bold(walker)} holds slot ${walkerSlot}: pays until the payout, then walks away.`);

rule('1. Slot-priced collateral   S_k = max(C, (n − k) × C × coverage)');
console.log(dim(`${pad('slot', 6)}${pad('member', 10)}${padLeft('owes after payout', 20)}${padLeft('collateral S_k', 18)}${padLeft('order fee F_k', 16)}${padLeft('fee share', 12)}`));
for (const q of slotTable(terms)) {
  const name = sim.attacked.circle.slots[q.slot - 1];
  console.log(`${pad(q.slot, 6)}${pad(name, 10)}${padLeft(N(q.owedAfterPayout), 20)}${padLeft(N(q.collateral), 18)}${padLeft(N(q.fee), 16)}${padLeft(N(q.feeShare), 12)}`);
}
if (vouches.length) console.log(mint(`\nuncle.london vouches ${N(vouches[0].amount)} NEAR of ${walker}'s collateral ("diaspora backs, home borrows").`));

rule('2. Rounds');
for (const round of sim.attacked.rounds) {
  const r = round.record;
  const missed = r.missed.length ? red(`missed: ${r.missed.join(', ')}`) : mint('everyone paid');
  console.log(`\n${bold(`Round ${r.round}`)} → recipient ${bold(r.recipient)}   ${missed}`);
  for (const e of round.events) {
    if (e.event === 'voucher_slashed') {
      console.log(red(`  ✂ ${N(e.data.amount)} NEAR slashed from voucher ${e.data.by} (backing ${e.data.account})`));
    }
    if (e.event === 'member_slashed') {
      const own = BigInt(e.data.amount);
      const uncovered = BigInt(e.data.uncovered);
      if (own > 0n) console.log(red(`  ✂ ${N(own)} NEAR slashed from ${e.data.account}'s own collateral`));
      if (uncovered > 0n) console.log(red(`  ! ${N(uncovered)} NEAR not covered — ${r.recipient} is left short`));
    }
  }
  const w = round.after.members.find((m) => m.account === walker);
  console.log(`  pot ${N(r.pot)} − fee ${N(r.fee)} → ${mint(`${N(r.paid)} NEAR paid to ${r.recipient}`)}` +
    dim(`   [${walker}'s collateral left: ${N(w.collateral)}]`));
}

rule('3. Final ledger (NEAR)');
console.log(dim(`${pad('account', 14)}${padLeft('paid in', 10)}${padLeft('payout', 10)}${padLeft('slashed', 10)}${padLeft('fee paid', 10)}${padLeft('fee earned', 12)}${padLeft('net', 10)}${padLeft('if all honest', 15)}  result`));
for (const row of sim.ledger) {
  if (row.role === 'voucher') {
    console.log(`${pad(row.account, 14)}${padLeft('—', 10)}${padLeft('—', 10)}${padLeft(N(row.slashed), 10)}${padLeft('—', 10)}${padLeft('—', 12)}${padLeft(signed(row.net), 10)}${padLeft('—', 15)}  ${red('voucher: slashed first')}`);
    continue;
  }
  const verdict = row.isWalker
    ? (row.net <= 0n ? red('walked away — gained nothing')
      : red(sim.walkerSideNet <= 0n ? 'walked away — paid for by their voucher' : 'walked away WITH A GAIN'))
    : (row.madeWhole ? mint('made whole') : red(`left short ${N(row.short)}`));
  console.log(`${pad(row.account, 14)}${padLeft(N(row.contributed), 10)}${padLeft(N(row.received), 10)}${padLeft(N(row.slashed), 10)}${padLeft(N(row.feePaid), 10)}${padLeft(N(row.feeEarned), 12)}${padLeft(signed(row.net), 10)}${padLeft(signed(row.baselineNet), 15)}  ${verdict}`);
}

rule('4. Verdict');
const closed = walkAwayPayoff(terms, walkerSlot);
console.log(`walker net        ${signed(sim.walkerNet)} NEAR` + (vouches.length ? `   (walker + voucher: ${signed(sim.walkerSideNet)} NEAR)` : `   (closed form: ${signed(closed.net)} NEAR)`));
console.log(`group shortfall   ${N(sim.shortfall)} NEAR`);
console.log(`left in contract  ${N(sim.attacked.totals.escrow)} NEAR`);
const safe = sim.walkerSideNet <= 0n && sim.othersMadeWhole && sim.shortfall === 0n;
if (safe) {
  console.log(mint(bold('\n✓ INVARIANT HOLDS: walking away earned nothing and every other member was made whole.')));
} else {
  console.log(red(bold('\n✗ The group was left short. This is the trade-off of coverage below 100% (friends mode).')));
  console.log(dim('  Re-run with --coverage 10000 to see the strangers-mode guarantee.'));
}
console.log('');
