import { formatNear } from '@shared/units.js';

/** yoctoNEAR → "20" / "0.80" (trailing ".00" dropped for whole numbers). */
export function near(yocto, precision = 2) {
  const text = formatNear(yocto ?? 0n, precision);
  return text.endsWith('.00') ? text.slice(0, -3) : text;
}

export const nearExact = (yocto) => formatNear(yocto ?? 0n, 2);

export function signedNear(yocto) {
  const value = BigInt(yocto);
  return value > 0n ? `+${nearExact(value)}` : nearExact(value);
}

/** "ada.testnet" → "ada"; long implicit accounts are shortened. */
export function shortName(account) {
  if (!account) return '—';
  const first = account.split('.')[0];
  return first.length > 14 ? `${first.slice(0, 6)}…${first.slice(-4)}` : first;
}

export const initial = (account) => (account ? account[0].toUpperCase() : '+');

/** Nanosecond duration → "4d 06h", "03h 12m", "02m 09s". */
export function duration(ns) {
  let seconds = Number(BigInt(ns) / 1_000_000_000n);
  if (seconds <= 0) return '00m 00s';
  const days = Math.floor(seconds / 86400);
  seconds -= days * 86400;
  const hours = Math.floor(seconds / 3600);
  seconds -= hours * 3600;
  const minutes = Math.floor(seconds / 60);
  seconds -= minutes * 60;
  const two = (n) => String(n).padStart(2, '0');
  if (days > 0) return `${days}d ${two(hours)}h`;
  if (hours > 0) return `${two(hours)}h ${two(minutes)}m`;
  return `${two(minutes)}m ${two(seconds)}s`;
}

export function roundLength(ns) {
  const seconds = Number(BigInt(ns) / 1_000_000_000n);
  if (seconds % 86400 === 0) return `${seconds / 86400} day${seconds === 86400 ? '' : 's'}`;
  if (seconds % 3600 === 0) return `${seconds / 3600} hour${seconds === 3600 ? '' : 's'}`;
  if (seconds % 60 === 0) return `${seconds / 60} min`;
  return `${seconds} sec`;
}

export function when(ns) {
  const date = new Date(Number(BigInt(ns) / 1_000_000n));
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export const percent = (bps) => `${Number(bps) / 100}%`;

const EVENT_TEXT = {
  circle_created: ['Circle created', 'info'],
  member_joined: ['Took a slot', 'info'],
  stake_added: ['Added collateral', 'info'],
  member_left: ['Left the circle', 'info'],
  vouched: ['Vouched for a member', 'info'],
  vouch_cancelled: ['Vouch withdrawn', 'info'],
  circle_started: ['Circle started', 'info'],
  contributed: ['Contributed', 'in'],
  contribution_netted: ['Own contribution netted', 'info'],
  voucher_slashed: ['Voucher slashed', 'slash'],
  member_slashed: ['Collateral slashed', 'slash'],
  round_paid: ['Pot paid out', 'pay'],
  round_started: ['Next round opened', 'info'],
  rounds_complete: ['All rounds paid', 'info'],
  circle_completed: ['Circle closed, collateral refunded', 'pay'],
  note_posted: ['Alajo posted a note', 'info'],
};

/** History entry ({t, e, a, x, b, r}) → display fields. */
export function describeEvent(entry) {
  const [text, kind] = EVENT_TEXT[entry.e] ?? [entry.e, 'info'];
  return { text, kind, who: entry.b ? `${shortName(entry.b)} → ${shortName(entry.a)}` : shortName(entry.a), amount: entry.x, round: entry.r, at: entry.t };
}
