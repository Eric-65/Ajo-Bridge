/**
 * Ajo Bridge — rotating savings circle contract (near-sdk-js, native NEAR).
 *
 * This file is deliberately thin. Every rule about money lives in
 * shared/ajoEngine.js, a pure state machine that is also run by the tests,
 * `npm run demo` and the web app's demo mode. Each change method here does
 * exactly four things:
 *
 *   1. read the caller, the attached deposit and the block time;
 *   2. load the circle and hand everything to the engine;
 *   3. save the circle;
 *   4. perform the transfers and log the events the engine returned.
 *
 * Custody: there is no method that lets the owner, the agent, the creator or
 * anyone else withdraw a pot or somebody else's collateral. NEAR only leaves
 * this contract through the transfer list produced by the engine: payouts to
 * the round's recipient, repayments to short-paid members, refunds of a
 * caller's own deposit and fee-pool shares.
 */

import { NearBindgen, call, initialize, near, view } from 'near-sdk-js';

// Namespace import on purpose: near-sdk-js exports one top-level function per contract
// method (join, vouch, leave, ...), which would collide with the engine's function names.
import * as engine from '../../shared/ajoEngine.js';

const EVENT_STANDARD = 'ajo_bridge';
const EVENT_VERSION = '1.0.0';

const YOCTO_PER_BYTE = 10n ** 19n; // protocol storage price: 1 NEAR per 100 kB
/** Bytes reserved per circle for its whole life: terms, capped history, per-member records. */
const STORAGE_BASE_BYTES = 8000n;
const STORAGE_BYTES_PER_MEMBER = 2500n;

const MAX_NOTE_LENGTH = 280;
const MAX_NOTES = 10;
const MAX_LIST_LIMIT = 50;
const NS_PER_SECOND = 1_000_000_000n;

const circleKey = (id) => `c:${id}`;
const jsonSafe = (value) => JSON.parse(JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));

function storageFee(members) {
  return (STORAGE_BASE_BYTES + STORAGE_BYTES_PER_MEMBER * BigInt(members)) * YOCTO_PER_BYTE;
}

function loadCircle(circleId) {
  const raw = near.storageRead(circleKey(circleId));
  if (raw === null) throw new Error(`circle ${circleId} does not exist`);
  return engine.deserializeCircle(raw);
}

function saveCircle(circle) {
  near.storageWrite(circleKey(circle.id), engine.serializeCircle(circle));
}

/** NEP-297 structured event log. */
function logEvent(event, data) {
  near.log(`EVENT_JSON:${JSON.stringify({ standard: EVENT_STANDARD, version: EVENT_VERSION, event, data: [jsonSafe(data)] })}`);
}

/** Execute the engine's side effects: one NEAR transfer per recipient, one log per event. */
function applyEffects({ transfers, events }) {
  const totals = new Map();
  for (const t of transfers) totals.set(t.to, (totals.get(t.to) ?? 0n) + t.amount);
  for (const [accountId, amount] of totals) {
    if (amount <= 0n) continue;
    const promise = near.promiseBatchCreate(accountId);
    near.promiseBatchActionTransfer(promise, amount);
  }
  for (const e of events) logEvent(e.event, e.data);
}

function refund(accountId, amount) {
  if (amount <= 0n) return;
  const promise = near.promiseBatchCreate(accountId);
  near.promiseBatchActionTransfer(promise, amount);
}

function circleId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id < 0) throw new Error('circle_id must be a non-negative integer');
  return id;
}

function circleSummary(circle) {
  return jsonSafe({
    id: circle.id,
    name: circle.name,
    creator: circle.creator,
    status: circle.status,
    members: circle.n,
    joined: circle.slots.filter(Boolean).length,
    contribution: circle.contribution,
    coverage_bps: circle.coverage_bps,
    order_fee_bps: circle.order_fee_bps,
    round_ns: circle.round_ns,
    round: circle.round,
    deadline_ns: circle.deadline_ns,
  });
}

function memberView(circle, member) {
  const required = engine.requiredCollateral(circle, member.slot);
  return jsonSafe({
    ...member,
    required_collateral: required,
    collateral: engine.collateralOf(member),
    fully_collateralised: engine.collateralOf(member) >= required,
    paid_this_round: circle.round > 0 && member.last_paid_round === circle.round,
  });
}

@NearBindgen({ requireInit: true })
export class AjoBridge {
  constructor() {
    this.owner = '';
    this.agent = '';
    this.next_id = 0;
  }

  /**
   * @param owner account allowed to change the agent (nothing else)
   * @param agent the Alajo coordinator account, the only caller of post_note
   */
  @initialize({})
  init({ owner, agent }) {
    this.owner = owner || near.predecessorAccountId();
    this.agent = agent || this.owner;
    this.next_id = 0;
    logEvent('contract_initialised', { owner: this.owner, agent: this.agent });
  }

  // ------------------------------------------------------------------ change methods

  /**
   * Create a circle. Attach the storage fee (see get_config / storage_fee); any excess is refunded.
   * @returns {number} the new circle id
   */
  @call({ payableFunction: true })
  create_circle({ name, members, contribution, round_secs, coverage_bps, order_fee_bps }) {
    const creator = near.predecessorAccountId();
    const attached = near.attachedDeposit();
    const fee = storageFee(Number(members));
    if (attached < fee) throw new Error(`attach at least ${fee} yoctoNEAR to pay for the circle's storage`);

    const id = this.next_id;
    const { circle, events } = engine.createCircle({
      id,
      creator,
      name,
      n: Number(members),
      contribution: String(contribution),
      coverageBps: Number(coverage_bps),
      orderFeeBps: Number(order_fee_bps),
      roundNs: BigInt(round_secs) * NS_PER_SECOND,
      now: near.blockTimestamp(),
    });
    this.next_id = id + 1;
    saveCircle(circle);
    applyEffects({ transfers: [], events });
    refund(creator, attached - fee);
    return id;
  }

  /** Take an open payout slot. The attached NEAR is your collateral (see quote_slot). */
  @call({ payableFunction: true })
  join({ circle_id, slot }) {
    const circle = loadCircle(circleId(circle_id));
    const fx = engine.join(circle, {
      account: near.predecessorAccountId(),
      slot: Number(slot),
      deposit: near.attachedDeposit(),
      now: near.blockTimestamp(),
    });
    saveCircle(circle);
    applyEffects(fx);
  }

  /** Put up part or all of a member's collateral. Your stake is slashed before theirs. */
  @call({ payableFunction: true })
  vouch({ circle_id, member }) {
    const circle = loadCircle(circleId(circle_id));
    const fx = engine.vouch(circle, {
      voucher: near.predecessorAccountId(),
      member,
      deposit: near.attachedDeposit(),
      now: near.blockTimestamp(),
    });
    saveCircle(circle);
    applyEffects(fx);
  }

  /** Take your vouch back. Only possible before the circle starts. */
  @call({})
  cancel_vouch({ circle_id, member }) {
    const circle = loadCircle(circleId(circle_id));
    const fx = engine.cancelVouch(circle, { voucher: near.predecessorAccountId(), member, now: near.blockTimestamp() });
    saveCircle(circle);
    applyEffects(fx);
  }

  /** Leave before the start. You and your vouchers are refunded in full. */
  @call({})
  leave({ circle_id }) {
    const circle = loadCircle(circleId(circle_id));
    const fx = engine.leave(circle, { account: near.predecessorAccountId(), now: near.blockTimestamp() });
    saveCircle(circle);
    applyEffects(fx);
  }

  /** Pay this round's contribution. When the last member pays, the recipient is paid in the same call. */
  @call({ payableFunction: true })
  contribute({ circle_id }) {
    const circle = loadCircle(circleId(circle_id));
    const fx = engine.contribute(circle, {
      account: near.predecessorAccountId(),
      deposit: near.attachedDeposit(),
      now: near.blockTimestamp(),
    });
    saveCircle(circle);
    applyEffects(fx);
  }

  /** Anyone may settle a round once its deadline has passed. Takes no deposit and no arguments about money. */
  @call({})
  settle_round({ circle_id }) {
    const circle = loadCircle(circleId(circle_id));
    const fx = engine.settleRound(circle, { now: near.blockTimestamp() });
    saveCircle(circle);
    applyEffects(fx);
  }

  /** Anyone may close a circle after its last round: refunds collateral and shares out the fee pool. */
  @call({})
  finalize({ circle_id }) {
    const circle = loadCircle(circleId(circle_id));
    const fx = engine.finalize(circle, { now: near.blockTimestamp() });
    saveCircle(circle);
    applyEffects(fx);
  }

  /** Agent only: attach a short plain-text note (reminder, round report) to a circle. Moves no money. */
  @call({})
  post_note({ circle_id, text }) {
    const caller = near.predecessorAccountId();
    if (caller !== this.agent) throw new Error('only the Alajo agent can post notes');
    const note = String(text ?? '').trim();
    if (note.length === 0 || note.length > MAX_NOTE_LENGTH) {
      throw new Error(`note must be between 1 and ${MAX_NOTE_LENGTH} characters`);
    }
    const circle = loadCircle(circleId(circle_id));
    circle.notes.push({ t: near.blockTimestamp().toString(), by: caller, text: note, r: circle.round });
    if (circle.notes.length > MAX_NOTES) circle.notes.splice(0, circle.notes.length - MAX_NOTES);
    saveCircle(circle);
    logEvent('note_posted', { circle_id: circle.id, round: circle.round, account: caller, text: note });
  }

  /** Owner only: point the contract at a different Alajo agent account. */
  @call({})
  set_agent({ agent }) {
    if (near.predecessorAccountId() !== this.owner) throw new Error('only the owner can change the agent');
    if (!agent) throw new Error('agent account is required');
    this.agent = agent;
    logEvent('agent_changed', { agent });
  }

  // ------------------------------------------------------------------ views

  @view({})
  get_config() {
    return jsonSafe({
      owner: this.owner,
      agent: this.agent,
      circles: this.next_id,
      limits: engine.LIMITS,
      storage_base_bytes: STORAGE_BASE_BYTES,
      storage_bytes_per_member: STORAGE_BYTES_PER_MEMBER,
      max_note_length: MAX_NOTE_LENGTH,
    });
  }

  /** Storage fee (yoctoNEAR) to attach to create_circle for a circle of `members`. */
  @view({})
  storage_fee({ members }) {
    return storageFee(Number(members)).toString();
  }

  /** Full circle state, amounts as decimal strings, plus who still has to pay this round. */
  @view({})
  get_circle({ circle_id }) {
    const circle = loadCircle(circleId(circle_id));
    const members = {};
    for (const member of engine.membersInSlotOrder(circle)) members[member.account] = memberView(circle, member);
    return { ...jsonSafe(circle), members, unpaid: engine.unpaidMembers(circle), now_ns: near.blockTimestamp().toString() };
  }

  @view({})
  get_member({ circle_id, account_id }) {
    const circle = loadCircle(circleId(circle_id));
    const member = engine.getMember(circle, account_id);
    return member ? memberView(circle, member) : null;
  }

  /** Collateral S_k and order fee F_k for a slot, before you commit to it. */
  @view({})
  quote_slot({ circle_id, slot }) {
    return jsonSafe(engine.quoteSlot(loadCircle(circleId(circle_id)), Number(slot)));
  }

  /** Circle summaries, newest first. */
  @view({})
  list_circles({ from_index, limit } = {}) {
    const count = Math.min(Number(limit ?? 20), MAX_LIST_LIMIT);
    const start = from_index === undefined || from_index === null ? this.next_id - 1 : Number(from_index);
    const result = [];
    for (let id = start; id >= 0 && result.length < count; id--) {
      const raw = near.storageRead(circleKey(id));
      if (raw !== null) result.push(circleSummary(engine.deserializeCircle(raw)));
    }
    return result;
  }
}
