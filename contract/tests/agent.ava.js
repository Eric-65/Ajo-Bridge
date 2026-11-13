/** What the Alajo agent and everyone else can and cannot do: access control and custody. */
import test from 'ava';
import { KeyPair } from 'near-workspaces';

import { GAS, N, call, createCircle, getCircle, newAccounts, passDeadline, startSandbox } from './helpers.js';

test.before(async (t) => {
  t.context = await startSandbox();
});

test.after.always(async (t) => {
  await t.context.worker?.tearDown();
});

// ---------------------------------------------------------------------------

test.serial('the Alajo agent: notes only, with a function-call key that cannot move money', async (t) => {
  const { root, contract, agent, owner, worker } = t.context;
  const [ada, bayo] = await newAccounts(root, ['ada', 'bayo']);
  const id = await createCircle(ada, contract, { members: 2, contribution: N(10), coverage_bps: 10000, order_fee_bps: 0 });

  await t.throwsAsync(call(ada, contract, 'post_note', { circle_id: id, text: 'hi' }), { message: /only the Alajo agent/ });
  await t.throwsAsync(call(ada, contract, 'set_agent', { agent: ada.accountId }), { message: /only the owner/ });

  // Give the agent account a function-call access key limited to three methods, then sign with it.
  const fullKey = await agent.getKey();
  const limited = KeyPair.fromRandom('ed25519');
  await agent.batch(agent).addKey(limited.getPublicKey(), {
    nonce: 0,
    permission: {
      functionCall: {
        allowance: BigInt(N(1)),
        receiverId: contract.accountId,
        methodNames: ['settle_round', 'post_note', 'finalize'],
      },
    },
  }).transact();
  await agent.setKey(limited);

  try {
    const note = await call(agent, contract, 'post_note', { circle_id: id, text: 'Round 1 don start. Abeg pay before deadline.' });
    t.is(note.events[0].event, 'note_posted');
    t.is((await getCircle(contract, id)).notes[0].text, 'Round 1 don start. Abeg pay before deadline.');
    await t.throwsAsync(call(agent, contract, 'post_note', { circle_id: id, text: 'x'.repeat(281) }), { message: /between 1 and 280/ });

    // The protocol itself rejects everything else this key tries.
    const refused = async (method, args, deposit) => {
      const error = await t.throwsAsync(agent.callRaw(contract, method, args, { gas: GAS, attachedDeposit: deposit }));
      return String(error?.message ?? error) + JSON.stringify(error ?? {});
    };
    t.regex(await refused('contribute', { circle_id: id }, '0'), /MethodNameMismatch|method name/i, 'not on the key\'s method list');
    t.regex(await refused('settle_round', { circle_id: id }, '1'), /DepositWithFunctionCall|deposit/i, 'function-call keys cannot attach NEAR');
    await t.throwsAsync(agent.transfer(ada, N(1)), undefined, 'and cannot send transfers');

    // What the key CAN do: settle a round nobody finished, and close the circle.
    await call(ada, contract, 'join', { circle_id: id, slot: 1 }, N(10));
    await call(bayo, contract, 'join', { circle_id: id, slot: 2 }, N(10));
    for (let round = 1; round <= 2; round++) {
      await call(bayo, contract, 'contribute', { circle_id: id }, N(10));
      await passDeadline(worker, contract, id);
      const settled = await call(agent, contract, 'settle_round', { circle_id: id });
      t.truthy(settled.events.find((e) => e.event === 'round_paid'));
    }
    await call(agent, contract, 'finalize', { circle_id: id });
    t.is((await getCircle(contract, id)).status, 'COMPLETED');
  } finally {
    await agent.setKey(fullKey);
  }

  await call(owner, contract, 'set_agent', { agent: ada.accountId });
  t.is((await contract.view('get_config')).agent, ada.accountId);
  await call(owner, contract, 'set_agent', { agent: agent.accountId });
});

test.serial('custody: there is no way to pull money out of a circle', async (t) => {
  const { root, contract, owner, agent } = t.context;
  const [ada, bayo] = await newAccounts(root, ['ada', 'bayo']);
  const id = await createCircle(ada, contract, { members: 2, contribution: N(10), coverage_bps: 10000, order_fee_bps: 0 });
  await call(ada, contract, 'join', { circle_id: id, slot: 1 }, N(10));
  await call(bayo, contract, 'join', { circle_id: id, slot: 2 }, N(10));
  await call(ada, contract, 'contribute', { circle_id: id }, N(10));

  // The contract's complete public surface. Nothing here takes an amount or a destination.
  for (const [account, method] of [[owner, 'withdraw'], [agent, 'withdraw_pot'], [ada, 'sweep'], [owner, 'migrate'], [agent, 'transfer']]) {
    await t.throwsAsync(call(account, contract, method, { circle_id: id, amount: N(1) }), { message: /MethodNotFound/ });
  }
  // Methods that move no caller money refuse deposits; the init method cannot be replayed.
  await t.throwsAsync(call(ada, contract, 'settle_round', { circle_id: id }, '1'), { message: /not payable/ });
  await t.throwsAsync(call(ada, contract, 'finalize', { circle_id: id }, '1'), { message: /not payable/ });
  await t.throwsAsync(call(owner, contract, 'init', { owner: ada.accountId, agent: ada.accountId }), { message: /already initialized/i });
  await t.throwsAsync(call(ada, contract, 'contribute', { circle_id: 9999 }, N(10)), { message: /does not exist/ });
  const circle = await getCircle(contract, id);
  t.is(circle.escrow, N(30), 'collateral and the round\'s pot are still there');
});
