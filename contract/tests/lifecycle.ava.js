/** Circle lifecycle on the NEAR sandbox: create, quote, join, leave, an honest circle end to end. */
import test from 'ava';

import { feeShares, slotCollateral, slotFee } from '../../shared/ajoMath.js';
import { N, balance, call, createCircle, getCircle, newAccounts, startSandbox, toNear } from './helpers.js';

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

test.serial('create_circle: charges the storage fee, refunds the excess, logs a NEP-297 event', async (t) => {
  const { root, contract } = t.context;
  const [ada] = await newAccounts(root, ['ada']);
  const fee = BigInt(await contract.view('storage_fee', { members: 5 }));
  const before = await balance(ada);

  await t.throwsAsync(
    call(ada, contract, 'create_circle', { name: 'x', members: 5, contribution: N(1), round_secs: 30, coverage_bps: 10000, order_fee_bps: 100 }, (fee - 1n).toString()),
    { message: /pay for the circle's storage/ },
  );
  const created = await call(ada, contract, 'create_circle', {
    name: 'Market women', members: 5, contribution: N(20), round_secs: 30, coverage_bps: 10000, order_fee_bps: 100,
  }, (fee + BigInt(N(3))).toString());

  const spent = before - (await balance(ada));
  t.true(spent >= fee && spent < fee + GAS_TOLERANCE, `only the fee is kept (spent ${toNear(spent)} NEAR)`);
  t.is(created.events[0].standard, 'ajo_bridge');
  t.is(created.events[0].version, '1.0.0');
  t.is(created.events[0].event, 'circle_created');
  t.is(created.events[0].data[0].name, 'Market women');

  const circle = await getCircle(contract, created.value);
  t.is(circle.status, 'OPEN');
  t.is(circle.contribution, N(20));
  t.deepEqual(circle.slots, [null, null, null, null, null]);

  const listed = await contract.view('list_circles', {});
  t.is(listed[0].id, created.value);
  t.is(listed[0].joined, 0);
});

test.serial('create_circle: rejects bad terms', async (t) => {
  const { root, contract } = t.context;
  const [ada] = await newAccounts(root, ['ada']);
  const good = { name: 'x', members: 3, contribution: N(1), round_secs: 30, coverage_bps: 10000, order_fee_bps: 100 };
  const fee = N(1);
  await t.throwsAsync(call(ada, contract, 'create_circle', { ...good, members: 1 }, fee), { message: /members must be/ });
  await t.throwsAsync(call(ada, contract, 'create_circle', { ...good, contribution: '0' }, fee), { message: /contribution must be positive/ });
  await t.throwsAsync(call(ada, contract, 'create_circle', { ...good, coverage_bps: 12000 }, fee), { message: /coverage_bps/ });
  await t.throwsAsync(call(ada, contract, 'create_circle', { ...good, order_fee_bps: 5000 }, fee), { message: /order_fee_bps/ });
  await t.throwsAsync(call(ada, contract, 'create_circle', { ...good, round_secs: 1 }, fee), { message: /round length/ });
});

test.serial('quote_slot returns S_k and F_k exactly as the shared math computes them', async (t) => {
  const { root, contract } = t.context;
  const [ada] = await newAccounts(root, ['ada']);
  const terms = termsOf(5, 20, 10000, 100);
  const id = await createCircle(ada, contract, { members: 5, contribution: N(20), coverage_bps: 10000, order_fee_bps: 100 });
  for (let slot = 1; slot <= 5; slot++) {
    const quote = await contract.view('quote_slot', { circle_id: id, slot });
    t.is(quote.collateral, slotCollateral(terms, slot).toString(), `S_${slot}`);
    t.is(quote.fee, slotFee(terms, slot).toString(), `F_${slot}`);
    t.is(quote.fee_share, feeShares(terms)[slot - 1].toString());
  }
  t.is((await contract.view('quote_slot', { circle_id: id, slot: 1 })).collateral, N(80));
  t.is((await contract.view('quote_slot', { circle_id: id, slot: 5 })).collateral, N(20));
});

test.serial('before the start: slots are first come first served; leave and cancel_vouch refund in full', async (t) => {
  const { root, contract } = t.context;
  const [ada, bayo, uncle] = await newAccounts(root, ['ada', 'bayo', 'uncle']);
  const id = await createCircle(ada, contract, { members: 3, contribution: N(10), coverage_bps: 10000, order_fee_bps: 100 });

  await t.throwsAsync(call(ada, contract, 'join', { circle_id: id, slot: 1 }, N(1)), { message: /attach at least/ });
  const adaBefore = await balance(ada);
  await call(ada, contract, 'join', { circle_id: id, slot: 1 }, N(25)); // S_1 = 20: 5 comes straight back
  t.true(adaBefore - (await balance(ada)) < BigInt(N(20)) + GAS_TOLERANCE, 'excess collateral is refunded');
  await t.throwsAsync(call(bayo, contract, 'join', { circle_id: id, slot: 1 }, N(20)), { message: /already taken/ });

  // bayo reserves slot 2 with 2 NEAR, his uncle vouches the other 8.
  await call(bayo, contract, 'join', { circle_id: id, slot: 2 }, N(2));
  await call(uncle, contract, 'vouch', { circle_id: id, member: bayo.accountId }, N(8));
  let member = await contract.view('get_member', { circle_id: id, account_id: bayo.accountId });
  t.is(member.collateral, N(10));
  t.true(member.fully_collateralised);
  t.is(member.vouches[0].voucher, uncle.accountId);

  const uncleBefore = await balance(uncle);
  await call(uncle, contract, 'cancel_vouch', { circle_id: id, member: bayo.accountId });
  t.true((await balance(uncle)) - uncleBefore > BigInt(N(8)) - GAS_TOLERANCE, 'voucher gets the vouch back');

  // His backer is gone, so bayo tops up his own stake by joining his slot again.
  const topUp = await call(bayo, contract, 'join', { circle_id: id, slot: 2 }, N(8));
  t.is(topUp.events[0].event, 'stake_added');
  member = await contract.view('get_member', { circle_id: id, account_id: bayo.accountId });
  t.is(member.stake, N(10));

  const bayoBefore = await balance(bayo);
  await call(bayo, contract, 'leave', { circle_id: id });
  t.true((await balance(bayo)) - bayoBefore > BigInt(N(10)) - GAS_TOLERANCE, 'member gets the whole stake back');
  member = await contract.view('get_member', { circle_id: id, account_id: bayo.accountId });
  t.is(member, null);
  t.is((await getCircle(contract, id)).escrow, N(20), 'only ada\'s collateral is still held');
});

test.serial('honest circle end to end: instant payouts, refunds at the end, the circle keeps nothing', async (t) => {
  const { root, contract, worker } = t.context;
  const members = await newAccounts(root, ['ada', 'bayo', 'chidi']);
  const terms = termsOf(3, 10, 10000, 100);
  const id = await createCircle(members[0], contract, { members: 3, contribution: N(10), coverage_bps: 10000, order_fee_bps: 100 });
  const start = await Promise.all(members.map(balance));
  const contractStart = await balance(contract);

  await joinAll(contract, id, members, terms);
  let circle = await getCircle(contract, id);
  t.is(circle.status, 'ACTIVE');
  t.is(circle.round, 1);

  await t.throwsAsync(call(members[0], contract, 'settle_round', { circle_id: id }), { message: /deadline has not passed/ });
  await t.throwsAsync(call(t.context.owner, contract, 'contribute', { circle_id: id }, N(10)), { message: /not a member/ });
  await t.throwsAsync(call(members[0], contract, 'contribute', { circle_id: id }, N(9)), { message: /attach the contribution/ });
  await t.throwsAsync(call(members[0], contract, 'finalize', { circle_id: id }), { message: /still running/ });

  for (let round = 1; round <= 3; round++) {
    const recipient = members[round - 1];
    for (const member of members.slice(0, 2)) await call(member, contract, 'contribute', { circle_id: id }, N(10));
    t.deepEqual((await getCircle(contract, id)).unpaid, [members[2].accountId]);
    const before = await balance(recipient);
    const last = await call(members[2], contract, 'contribute', { circle_id: id }, N(10));
    const paid = last.events.find((e) => e.event === 'round_paid').data[0];
    t.is(paid.account, recipient.accountId);
    t.is(paid.amount, (30n * 10n ** 24n - slotFee(terms, round)).toString(), `round ${round} pays pot minus F_${round}`);
    if (recipient !== members[2]) {
      // Balances also move by gas refunds from the recipient's own earlier call, hence the tolerance.
      const delta = (await balance(recipient)) - before;
      t.true(delta >= BigInt(paid.amount) && delta < BigInt(paid.amount) + BigInt(N(1)),
        `the payout arrives in the same transaction (+${toNear(delta)} NEAR)`);
    }
  }
  await t.throwsAsync(call(members[0], contract, 'contribute', { circle_id: id }, N(10)), { message: /not running a round/ });

  circle = await getCircle(contract, id);
  t.is(circle.status, 'AWAITING_FINALIZE');
  const closing = await call(t.context.owner, contract, 'finalize', { circle_id: id }); // anyone may call it
  t.is(closing.events.at(-1).event, 'circle_completed');
  await t.throwsAsync(call(members[0], contract, 'finalize', { circle_id: id }), { message: /already finalized/ });

  circle = await getCircle(contract, id);
  t.is(circle.status, 'COMPLETED');
  t.is(circle.escrow, '0', 'nothing is left in the circle');
  t.is(circle.shortfall, '0');
  const shares = feeShares(terms);
  for (let i = 0; i < 3; i++) {
    const expected = shares[i] - slotFee(terms, i + 1);
    const actual = (await balance(members[i])) - start[i];
    t.true(actual <= expected && actual > expected - GAS_TOLERANCE,
      `${members[i].accountId}: net ${toNear(actual)} NEAR, expected ${toNear(expected)} minus gas`);
    t.is(circle.members[members[i].accountId].fee_earned, shares[i].toString());
  }
  const contractDelta = (await balance(contract)) - contractStart;
  t.true(contractDelta >= 0n && contractDelta < GAS_TOLERANCE, 'the contract kept no circle money');
  await worker.provider.fastForward(1);
});
