/** The walk-away invariant and voucher slashing, executed on the NEAR sandbox with real balances. */
import test from 'ava';

import { feeShares, slotCollateral, slotFee } from '../../shared/ajoMath.js';
import { N, balance, call, createCircle, getCircle, newAccounts, passDeadline, startSandbox, toNear } from './helpers.js';

/** Wallet balances move by gas as well as by circle money; 0.05 NEAR is far above any gas spent here. */
const GAS_TOLERANCE = BigInt(N(0.05));

test.before(async (t) => {
  t.context = await startSandbox();
});

test.after.always(async (t) => {
  await t.context.worker?.tearDown();
});

async function joinAll(contract, id, members, terms) {
  for (let i = 0; i < members.length; i++) {
    const collateral = slotCollateral(terms, i + 1).toString();
    await call(members[i], contract, 'join', { circle_id: id, slot: i + 1 }, collateral);
  }
}

const termsOf = (n, c, coverageBps, orderFeeBps) => ({ n, contribution: BigInt(N(c)), coverageBps, orderFeeBps });

// ---------------------------------------------------------------------------

test.serial('INVARIANT on chain: slot 1 collects the pot and walks away — no gain, nobody else loses', async (t) => {
  const { root, contract, worker } = t.context;
  const members = await newAccounts(root, ['ada', 'bayo', 'chidi', 'dupe']);
  const [walker, ...others] = members;
  const terms = termsOf(4, 10, 10000, 100);
  const id = await createCircle(members[1], contract, { members: 4, contribution: N(10), coverage_bps: 10000, order_fee_bps: 100 });
  const start = await Promise.all(members.map(balance));
  await joinAll(contract, id, members, terms);

  // Round 1: everyone pays, the walker is paid 40 − 0.3.
  for (const member of members) await call(member, contract, 'contribute', { circle_id: id }, N(10));
  t.is((await getCircle(contract, id)).members[walker.accountId].received, N(39.7));

  // Rounds 2..4: the walker never pays again. Anyone can settle after the deadline.
  for (let round = 2; round <= 4; round++) {
    for (const member of others) await call(member, contract, 'contribute', { circle_id: id }, N(10));
    await t.throwsAsync(call(others[0], contract, 'settle_round', { circle_id: id }), { message: /deadline has not passed/ });
    await passDeadline(worker, contract, id);
    const settled = await call(t.context.agent, contract, 'settle_round', { circle_id: id });
    const slashed = settled.events.find((e) => e.event === 'member_slashed').data[0];
    t.is(slashed.account, walker.accountId);
    t.is(slashed.amount, N(10), `round ${round}: one contribution is taken from the walker's collateral`);
    t.is(slashed.uncovered, '0');
    const paid = settled.events.find((e) => e.event === 'round_paid').data[0];
    t.is(paid.pot, N(40), `round ${round}: the recipient still gets a full pot`);
  }
  await call(others[0], contract, 'finalize', { circle_id: id });

  const circle = await getCircle(contract, id);
  t.is(circle.status, 'COMPLETED');
  t.is(circle.escrow, '0');
  t.is(circle.shortfall, '0', 'no group shortfall');
  const w = circle.members[walker.accountId];
  t.is(w.slashed, N(30));
  t.is(w.fee_earned, '0', 'a defaulter forfeits the fee share');

  // received − paid − slashed <= 0, measured on real balances (gas only makes it more negative).
  const walkerNet = (await balance(walker)) - start[0];
  t.true(walkerNet <= -slotFee(terms, 1), `walker net is ${toNear(walkerNet)} NEAR`);
  t.true(walkerNet > -slotFee(terms, 1) - GAS_TOLERANCE);

  const honestShares = feeShares(terms);
  for (let i = 1; i < 4; i++) {
    const baseline = honestShares[i] - slotFee(terms, i + 1);
    const net = (await balance(members[i])) - start[i];
    t.true(net > baseline - GAS_TOLERANCE, `${members[i].accountId}: net ${toNear(net)} NEAR vs honest baseline ${toNear(baseline)}`);
    t.is(circle.members[members[i].accountId].short, '0');
  }
});

test.serial('vouching on chain: the voucher is slashed before the member, and refunded what is left', async (t) => {
  const { root, contract, worker } = t.context;
  const [ada, bayo, uncle] = await newAccounts(root, ['ada', 'bayo', 'uncle']);
  const id = await createCircle(ada, contract, { members: 2, contribution: N(10), coverage_bps: 10000, order_fee_bps: 0 });
  // S_1 = S_2 = 10. Uncle backs 6 of ada's 10.
  await call(ada, contract, 'join', { circle_id: id, slot: 1 }, N(4));
  await call(uncle, contract, 'vouch', { circle_id: id, member: ada.accountId }, N(6));
  const backed = await contract.view('get_member', { circle_id: id, account_id: ada.accountId });
  t.is(backed.stake, N(4));
  t.is(backed.vouches[0].amount, N(6));
  await call(bayo, contract, 'join', { circle_id: id, slot: 2 }, N(10));
  await t.throwsAsync(call(uncle, contract, 'cancel_vouch', { circle_id: id, member: ada.accountId }), { message: /locked until the end/ });
  await t.throwsAsync(call(ada, contract, 'leave', { circle_id: id }), { message: /leaving is closed/ });

  for (const member of [ada, bayo]) await call(member, contract, 'contribute', { circle_id: id }, N(10));
  await call(bayo, contract, 'contribute', { circle_id: id }, N(10));
  await passDeadline(worker, contract, id);
  const uncleBefore = await balance(uncle);
  const settled = await call(bayo, contract, 'settle_round', { circle_id: id });
  const voucherSlash = settled.events.find((e) => e.event === 'voucher_slashed').data[0];
  t.is(voucherSlash.by, uncle.accountId);
  t.is(voucherSlash.amount, N(6));
  t.is(settled.events.find((e) => e.event === 'member_slashed').data[0].amount, N(4));
  await call(bayo, contract, 'finalize', { circle_id: id });
  const refunded = (await balance(uncle)) - uncleBefore;
  t.true(refunded >= 0n && refunded < BigInt(N(1)), 'nothing left to refund: the whole vouch was slashed');
  t.is((await getCircle(contract, id)).members[ada.accountId].vouches[0].slashed, N(6));
  t.is((await getCircle(contract, id)).escrow, '0');
});
