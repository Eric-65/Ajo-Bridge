/**
 * Demo mode: seeded circles that run entirely in the browser on the SAME engine
 * the contract executes (shared/ajoEngine.js). No wallet, no network. Judges can
 * click through every action; the header shows a "Demo data" badge.
 */
import * as engine from '@shared/ajoEngine.js';
import { parseNear } from '@shared/units.js';

import { AGENT_DEMO_ACCOUNT } from './config.js';

const STORAGE_KEY = 'ajo-bridge-demo-v2';
const DAY = 86_400n * 1_000_000_000n;
const HOUR = 3_600n * 1_000_000_000n;

export const PERSONAS = [
  'you.demo', 'ada.demo', 'bayo.demo', 'chidi.demo', 'dupe.demo', 'funke.demo', 'gbenga.demo', 'uncle.london',
];

const realNow = () => BigInt(Date.now()) * 1_000_000n;

function seed() {
  const now = realNow();
  const circles = {};

  // Circle 0 — already running. Ada (slot 1) has been paid and has not paid round 2.
  {
    const t0 = now - 9n * DAY;
    const { circle } = engine.createCircle({
      id: 0, creator: 'ada.demo', name: 'Balogun Market Traders', n: 5, contribution: parseNear('20'),
      coverageBps: 10000, orderFeeBps: 100, roundNs: 7n * DAY, now: t0,
    });
    const members = ['ada.demo', 'bayo.demo', 'chidi.demo', 'dupe.demo', 'you.demo'];
    members.forEach((account, i) => {
      const required = engine.requiredCollateral(circle, i + 1);
      const own = account === 'chidi.demo' ? required / 2n : required;
      engine.join(circle, { account, slot: i + 1, deposit: own, now: t0 + BigInt(i + 1) * HOUR });
    });
    engine.vouch(circle, { voucher: 'uncle.london', member: 'chidi.demo', deposit: parseNear('20'), now: t0 + 8n * HOUR });
    for (const account of members) engine.contribute(circle, { account, deposit: circle.contribution, now: now - 5n * DAY });
    for (const account of ['bayo.demo', 'chidi.demo', 'dupe.demo']) {
      engine.contribute(circle, { account, deposit: circle.contribution, now: now - 2n * DAY });
    }
    circle.notes.push({ t: (now - DAY).toString(), by: AGENT_DEMO_ACCOUNT, r: 2, text: 'Round 2: 2 members still to pay. Bayo collects when the pot is full.' });
    circles[0] = circle;
  }

  // Circle 1 — still filling. Funke has only reserved her slot and needs a backer.
  {
    const t0 = now - 2n * DAY;
    const { circle } = engine.createCircle({
      id: 1, creator: 'gbenga.demo', name: 'Lagos to London Family', n: 4, contribution: parseNear('10'),
      coverageBps: 10000, orderFeeBps: 50, roundNs: 30n * DAY, now: t0,
    });
    engine.join(circle, { account: 'funke.demo', slot: 1, deposit: engine.minReserve(circle, 1), now: t0 + HOUR });
    engine.join(circle, { account: 'gbenga.demo', slot: 3, deposit: engine.requiredCollateral(circle, 3), now: t0 + 2n * HOUR });
    circles[1] = circle;
  }

  return { circles, nextId: 2, persona: 'you.demo', clockOffset: 0n };
}

function save(state) {
  try {
    const circles = Object.fromEntries(Object.entries(state.circles).map(([id, c]) => [id, engine.serializeCircle(c)]));
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ circles, nextId: state.nextId, persona: state.persona, clockOffset: state.clockOffset.toString() }));
  } catch { /* private mode or quota: the demo still works for this page load */ }
}

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!raw) return null;
    const circles = Object.fromEntries(Object.entries(raw.circles).map(([id, json]) => [id, engine.deserializeCircle(json)]));
    return { circles, nextId: raw.nextId, persona: raw.persona, clockOffset: BigInt(raw.clockOffset) };
  } catch {
    return null;
  }
}

let state = (typeof localStorage !== 'undefined' && load()) || seed();
const listeners = new Set();

function commit(next) {
  state = next;
  save(state);
  listeners.forEach((fn) => fn());
}

const clone = (circle) => engine.deserializeCircle(engine.serializeCircle(circle));

function circleOrFail(id) {
  const circle = state.circles[id];
  if (!circle) throw new Error(`circle ${id} does not exist`);
  return clone(circle);
}

export const demo = {
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  getSnapshot: () => state,
  now: () => realNow() + state.clockOffset,
  get account() { return state.persona; },
  setPersona(persona) { commit({ ...state, persona }); },
  reset() { commit(seed()); },

  /** Demo-only clock control: jump just past the current round's deadline. */
  skipToDeadline(id) {
    const circle = state.circles[id];
    if (!circle || circle.status !== engine.STATUS.ACTIVE) return;
    const gap = circle.deadline_ns - demo.now();
    if (gap > 0n) commit({ ...state, clockOffset: state.clockOffset + gap + 1_000_000_000n });
  },

  async list() {
    return Object.values(state.circles)
      .sort((a, b) => Number(b.id) - Number(a.id))
      .map((c) => ({
        id: c.id, name: c.name, creator: c.creator, status: c.status, members: c.n,
        joined: c.slots.filter(Boolean).length, contribution: c.contribution, coverage_bps: c.coverage_bps,
        order_fee_bps: c.order_fee_bps, round_ns: c.round_ns, round: c.round, deadline_ns: c.deadline_ns,
      }));
  },

  async get(id) {
    return circleOrFail(id);
  },

  /** Mirrors the contract's change methods. Resolves with the engine's events and transfers. */
  async act(method, args = {}, deposit = 0n) {
    const now = demo.now();
    const caller = args.as ?? state.persona;
    if (method === 'create_circle') {
      const id = state.nextId;
      const { circle, events } = engine.createCircle({
        id, creator: caller, name: args.name, n: Number(args.members), contribution: args.contribution,
        coverageBps: Number(args.coverage_bps), orderFeeBps: Number(args.order_fee_bps),
        roundNs: BigInt(args.round_secs) * 1_000_000_000n, now,
      });
      commit({ ...state, circles: { ...state.circles, [id]: circle }, nextId: id + 1 });
      return { value: id, events, transfers: [] };
    }

    const circle = circleOrFail(args.circle_id);
    let fx;
    switch (method) {
      case 'join': fx = engine.join(circle, { account: caller, slot: Number(args.slot), deposit, now }); break;
      case 'vouch': fx = engine.vouch(circle, { voucher: caller, member: args.member, deposit, now }); break;
      case 'cancel_vouch': fx = engine.cancelVouch(circle, { voucher: caller, member: args.member, now }); break;
      case 'leave': fx = engine.leave(circle, { account: caller, now }); break;
      case 'contribute': fx = engine.contribute(circle, { account: caller, deposit, now }); break;
      case 'settle_round': fx = engine.settleRound(circle, { now }); break;
      case 'finalize': fx = engine.finalize(circle, { now }); break;
      case 'post_note': {
        const text = String(args.text ?? '').trim().slice(0, 280);
        if (!text) throw new Error('note is empty');
        circle.notes.push({ t: now.toString(), by: AGENT_DEMO_ACCOUNT, text, r: circle.round });
        if (circle.notes.length > 10) circle.notes.splice(0, circle.notes.length - 10);
        fx = { events: [{ event: 'note_posted', data: { circle_id: circle.id, text } }], transfers: [] };
        break;
      }
      default: throw new Error(`unknown method ${method}`);
    }
    commit({ ...state, circles: { ...state.circles, [circle.id]: circle } });
    return { value: null, events: fx.events, transfers: fx.transfers };
  },
};
