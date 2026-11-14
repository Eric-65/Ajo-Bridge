import { STATUS, collateralOf, membersInSlotOrder } from '@shared/ajoEngine.js';

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
