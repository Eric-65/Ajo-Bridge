import { STATUS, collateralOf, membersInSlotOrder, requiredCollateral } from '@shared/ajoEngine.js';

/** Totals across circles, computed only from circle state (chain data in live mode). */
export function circleStats(circles = []) {
  let members = 0;
  let locked = 0n;
  let roundsPaid = 0;
  let paidOut = 0n;
  for (const c of circles) {
    const list = membersInSlotOrder(c);
    members += list.length;
    if (c.status !== STATUS.COMPLETED) locked += list.reduce((sum, m) => sum + collateralOf(m), 0n) + c.pot;
    roundsPaid += c.rounds.length;
    paidOut += c.rounds.reduce((sum, r) => sum + BigInt(r.paid), 0n);
  }
  return { circles: circles.length, members, locked, roundsPaid, paidOut };
}

/** What the connected account has at stake in one circle, or null if nothing. */
export function myStake(circle, account) {
  if (!account) return null;
  const member = circle.members[account] ?? null;
  const vouches = membersInSlotOrder(circle).flatMap((m) => m.vouches.filter((v) => v.voucher === account && v.amount > 0n).map((v) => ({ member: m.account, amount: v.amount })));
  if (!member && vouches.length === 0) return null;
  const active = circle.status === STATUS.ACTIVE;
  const recipient = active ? circle.slots[circle.round - 1] : null;
  return {
    member,
    vouches,
    owesThisRound: Boolean(member && active && member.last_paid_round < circle.round && member.account !== recipient),
    collectsThisRound: Boolean(member && recipient === member.account),
    payoutRound: member?.slot ?? null,
    collateral: member ? collateralOf(member) : 0n,
  };
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Where a circle is stuck or what it needs next, in plain words, from full circle state.
 * `now` is in nanoseconds. Returns { label, cta, tone, open, unlocked, overdue }.
 */
export function circleProgress(circle, now) {
  const members = membersInSlotOrder(circle);
  const open = circle.n - members.length;
  const unlocked = members.filter((m) => collateralOf(m) < requiredCollateral(circle, m.slot)).length;
  if (circle.status === STATUS.OPEN) {
    if (open > 0 && unlocked > 0) {
      return { tone: 'mint', open, unlocked, label: `${plural(open, 'slot')} open · ${plural(unlocked, 'member')} still locking`, cta: `Pick a slot · ${open} open` };
    }
    if (open > 0) return { tone: 'mint', open, unlocked, label: `${plural(open, 'slot')} open`, cta: `Pick a slot · ${open} open` };
    return { tone: 'amber', open, unlocked, label: `Waiting for ${plural(unlocked, 'member')} to finish locking`, cta: 'Open circle' };
  }
  if (circle.status === STATUS.ACTIVE) {
    const overdue = now !== undefined && BigInt(now) > BigInt(circle.deadline_ns);
    return overdue
      ? { tone: 'red', open: 0, unlocked: 0, overdue, label: `Round ${circle.round} is overdue: anyone can settle it`, cta: 'Open circle · settle' }
      : { tone: 'dark', open: 0, unlocked: 0, overdue, label: `Round ${circle.round} of ${circle.n} running`, cta: 'Open circle' };
  }
  if (circle.status === STATUS.AWAITING_FINALIZE) return { tone: 'amber', open: 0, unlocked: 0, label: 'All rounds paid: anyone can close it', cta: 'Open circle · close' };
  return { tone: '', open: 0, unlocked: 0, label: 'Completed', cta: 'Open circle' };
}
