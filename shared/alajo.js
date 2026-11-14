/**
 * Alajo — the coordinator's brain, minus the language model.
 *
 * Everything the agent says is grounded in `circleFacts`, a plain summary
 * computed from on-chain circle state. The language model (NEAR AI Cloud) is
 * only asked to phrase these facts; when no model is available, the templates
 * below answer directly. Used by agent/alajo.js, api/alajo.js and the web
 * drawer's offline fallback.
 *
 * Languages: English (en), Nigerian Pidgin (pcm), Yoruba (yo). The Pidgin and
 * Yoruba templates are short on purpose and should be reviewed by a native speaker.
 */

import { STATUS, collateralOf, membersInSlotOrder, requiredCollateral } from './ajoEngine.js';
import { feeShares, slotFee } from './ajoMath.js';
import { formatNear } from './units.js';

export const LANGUAGES = { en: 'English', pcm: 'Pidgin', yo: 'Yorùbá' };

const amount = (yocto) => {
  const text = formatNear(yocto, 2);
  return `${text.endsWith('.00') ? text.slice(0, -3) : text} NEAR`;
};
const short = (account) => (account ? account.split('.')[0] : '');
const list = (accounts) => accounts.map(short).join(', ');

/** Nanoseconds → "4 days", "3 hours", "12 minutes". */
export function humanDuration(ns) {
  const seconds = Number(BigInt(ns) / 1_000_000_000n);
  if (seconds <= 0) return '0 minutes';
  if (seconds >= 172800) return `${Math.round(seconds / 86400)} days`;
  if (seconds >= 7200) return `${Math.round(seconds / 3600)} hours`;
  return `${Math.max(1, Math.round(seconds / 60))} minutes`;
}

/**
 * Plain facts about a circle, optionally from one account's point of view.
 * @param {object} circle  engine circle (BigInt amounts)
 * @param {{now: bigint, account?: string}} context
 */
export function circleFacts(circle, { now, account } = {}) {
  const at = BigInt(now ?? 0);
  const members = membersInSlotOrder(circle);
  const active = circle.status === STATUS.ACTIVE;
  const recipient = active ? circle.slots[circle.round - 1] : null;
  const unpaid = active ? members.filter((m) => m.last_paid_round < circle.round && m.account !== recipient).map((m) => m.account) : [];
  const pastDeadline = active && at > circle.deadline_ns;
  const terms = { n: circle.n, contribution: circle.contribution, coverageBps: circle.coverage_bps, orderFeeBps: circle.order_fee_bps };
  const mine = account ? members.find((m) => m.account === account) : null;

  return {
    id: circle.id,
    name: circle.name,
    status: circle.status,
    round: circle.round,
    rounds: circle.n,
    contribution: circle.contribution,
    potFull: BigInt(circle.n) * circle.contribution,
    pot: circle.pot,
    recipient,
    unpaid,
    pastDeadline,
    timeLeftNs: active && !pastDeadline ? circle.deadline_ns - at : 0n,
    feePool: circle.fee_pool,
    shortfall: circle.shortfall,
    defaulters: members.filter((m) => m.defaulted).map((m) => m.account),
    openSlots: circle.slots.map((holder, i) => (holder ? null : i + 1)).filter(Boolean),
    needBacking: circle.status === STATUS.OPEN
      ? members.filter((m) => collateralOf(m) < requiredCollateral(circle, m.slot))
        .map((m) => ({ account: m.account, gap: requiredCollateral(circle, m.slot) - collateralOf(m) }))
      : [],
    me: mine ? {
      account: mine.account,
      slot: mine.slot,
      isRecipient: mine.account === recipient,
      paidThisRound: active && mine.last_paid_round === circle.round,
      paidOut: mine.paid_out,
      roundsUntilTurn: active ? Math.max(0, mine.slot - circle.round) : mine.slot,
      collateral: collateralOf(mine),
      required: requiredCollateral(circle, mine.slot),
      defaulted: mine.defaulted,
      orderFee: slotFee(terms, mine.slot),
      feeShare: feeShares(terms)[mine.slot - 1],
    } : null,
  };
}

/** Map a free-text question to one of the things Alajo can answer from facts. */
export function classifyQuestion(question) {
  const q = String(question ?? '').toLowerCase();
  if (/miss|default|no pay|fail to pay|can.?t pay|if i (don.?t|no) pay|slash|kò bá san|ko ba san|ò bá san/.test(q)) return 'miss';
  if (/(who|ta ni|tani).*(pay|paid|san)|never pay|hasn.?t paid|not paid|unpaid|owing|late/.test(q)) return 'unpaid';
  if (/(my|mi).*(turn|slot|payout)|when.*(collect|paid|get)|turn|ìgbà|igba wo/.test(q)) return 'turn';
  if (/safe|run|steal|trust|collector|scam|withdraw|sá lọ|sa lo/.test(q)) return 'safety';
  if (/fee|interest|earn|èrè|ere/.test(q)) return 'fees';
  return 'status';
}

const T = {
  en: {
    notRunning: (f) => (f.status === STATUS.OPEN
      ? `${f.name} has not started. ${f.openSlots.length ? `Open slots: ${f.openSlots.join(', ')}.` : 'All slots are taken.'}${f.needBacking.length ? ` Still needing collateral: ${f.needBacking.map((b) => `${short(b.account)} (${amount(b.gap)})`).join(', ')}.` : ''}`
      : f.status === STATUS.COMPLETED ? `${f.name} is finished. Collateral has been refunded.` : `${f.name} has paid every round. Anyone can now close it to refund collateral.`),
    allPaid: (f) => `Everyone has paid round ${f.round}. ${short(f.recipient)} collects ${amount(f.potFull)} minus the order fee.`,
    unpaid: (f) => `Round ${f.round} of ${f.rounds}: ${list(f.unpaid)} ${f.unpaid.length === 1 ? 'has' : 'have'} not paid ${amount(f.contribution)} yet. ${f.pastDeadline ? 'The deadline has passed, so anyone can settle and their collateral will cover it.' : `${humanDuration(f.timeLeftNs)} left.`} ${short(f.recipient)} collects this round.`,
    noMember: () => 'You are not a member of this circle, so you have no payout turn.',
    turnDone: (f) => `You already collected in round ${f.me.slot}. Keep paying ${amount(f.contribution)} each round until round ${f.rounds}.`,
    turnNow: (f) => `It is your turn now: you collect round ${f.round}. The pot is paid the moment the last member pays, or when the round is settled.`,
    turnLater: (f) => `You hold slot ${f.me.slot}. You collect in ${f.me.roundsUntilTurn} round${f.me.roundsUntilTurn === 1 ? '' : 's'}: about ${amount(f.potFull - f.me.orderFee)}.`,
    miss: (f) => `If you miss a round, ${amount(f.contribution)} is taken from your collateral${f.me ? ` (you have ${amount(f.me.collateral)} locked)` : ''}, a voucher's stake first. You also lose your share of the fee pool. If collateral runs out before your payout, the debt is deducted from your payout.`,
    safety: () => 'Nobody holds the pot. The contract has no withdraw function: money only leaves as a payout to the round\'s recipient, a refund of your own collateral, or a fee share. My own key can only settle rounds and post notes.',
    fees: (f) => `The fee pool holds ${amount(f.feePool)}. Members who collect early pay into it; members who wait longer earn more of it.${f.me ? ` Your slot pays ${amount(f.me.orderFee)} and, if you never miss, earns ${amount(f.me.feeShare)}.` : ''}`,
    reminder: (f) => `Reminder for ${f.name}, round ${f.round}: ${list(f.unpaid)}, please pay ${amount(f.contribution)}. ${humanDuration(f.timeLeftNs)} left. ${short(f.recipient)} is collecting.`,
    report: (f, r) => `Round ${r.round} report: ${short(r.recipient)} was paid ${amount(r.paid)}.${r.missed.length ? ` Missed: ${list(r.missed)}; collateral covered it.` : ' Everyone paid.'} Fee pool: ${amount(f.feePool)}.`,
  },
  pcm: {
    notRunning: (f) => (f.status === STATUS.OPEN
      ? `${f.name} never start. ${f.openSlots.length ? `Slot wey still dey: ${f.openSlots.join(', ')}.` : 'All slot don full.'}${f.needBacking.length ? ` People wey still need collateral: ${f.needBacking.map((b) => `${short(b.account)} (${amount(b.gap)})`).join(', ')}.` : ''}`
      : f.status === STATUS.COMPLETED ? `${f.name} don finish. Everybody don collect their collateral back.` : `${f.name} don pay all round. Anybody fit close am make collateral return.`),
    allPaid: (f) => `Everybody don pay round ${f.round}. ${short(f.recipient)} go collect ${amount(f.potFull)} minus order fee.`,
    unpaid: (f) => `Round ${f.round} of ${f.rounds}: ${list(f.unpaid)} never pay ${amount(f.contribution)}. ${f.pastDeadline ? 'Time don pass, anybody fit settle am and their collateral go cover am.' : `E remain ${humanDuration(f.timeLeftNs)}.`} Na ${short(f.recipient)} dey collect this round.`,
    noMember: () => 'You no be member for this circle, so you no get turn.',
    turnDone: (f) => `You don collect for round ${f.me.slot}. Abeg continue to pay ${amount(f.contribution)} every round reach round ${f.rounds}.`,
    turnNow: (f) => `Na your turn be this: you dey collect round ${f.round}. Once the last person pay, the money go land.`,
    turnLater: (f) => `You hold slot ${f.me.slot}. E remain ${f.me.roundsUntilTurn} round before you collect about ${amount(f.potFull - f.me.orderFee)}.`,
    miss: (f) => `If you no pay, dem go comot ${amount(f.contribution)} from your collateral${f.me ? ` (you lock ${amount(f.me.collateral)})` : ''}; na person wey vouch for you go lose first. You go still lose your share for fee pool.`,
    safety: () => 'Nobody dey hold the money. The contract no get withdraw at all: money dey comot only as payout to person wey turn reach, refund of your own collateral, or fee share. My own key fit only settle round and post note.',
    fees: (f) => `Fee pool get ${amount(f.feePool)}. People wey collect early dey pay; people wey wait dey earn pass.${f.me ? ` Your slot go pay ${amount(f.me.orderFee)} and e go earn ${amount(f.me.feeShare)} if you no miss.` : ''}`,
    reminder: (f) => `${f.name}, round ${f.round}: ${list(f.unpaid)}, abeg pay ${amount(f.contribution)}. E remain ${humanDuration(f.timeLeftNs)}. Na ${short(f.recipient)} dey collect.`,
    report: (f, r) => `Round ${r.round}: ${short(r.recipient)} don collect ${amount(r.paid)}.${r.missed.length ? ` ${list(r.missed)} no pay; collateral cover am.` : ' Everybody pay.'} Fee pool: ${amount(f.feePool)}.`,
  },
  yo: {
    notRunning: (f) => (f.status === STATUS.OPEN
      ? `${f.name} kò tíì bẹ̀rẹ̀. ${f.openSlots.length ? `Àyè tó ṣí sílẹ̀: ${f.openSlots.join(', ')}.` : 'Gbogbo àyè ti kún.'}`
      : f.status === STATUS.COMPLETED ? `${f.name} ti parí. A ti dá owó ìdúró padà.` : `${f.name} ti san gbogbo ìpele. Ẹnikẹ́ni lè tì í pa báyìí.`),
    allPaid: (f) => `Gbogbo ènìyàn ti san fún ìpele ${f.round}. ${short(f.recipient)} ni yóò gba ${amount(f.potFull)}.`,
    unpaid: (f) => `Ìpele ${f.round} nínú ${f.rounds}: ${list(f.unpaid)} kò tíì san ${amount(f.contribution)}. ${f.pastDeadline ? 'Àkókò ti kọjá; owó ìdúró wọn ni yóò san án.' : `Ó ku ${humanDuration(f.timeLeftNs)}.`} ${short(f.recipient)} ni ó ń gba owó ní ìpele yìí.`,
    noMember: () => 'Ìwọ kì í ṣe ọmọ ẹgbẹ́ àjọ yìí.',
    turnDone: (f) => `O ti gba owó rẹ ní ìpele ${f.me.slot}. Jọ̀wọ́ máa san ${amount(f.contribution)} títí dé ìpele ${f.rounds}.`,
    turnNow: (f) => `Ìgbà tìrẹ nìyí: ìwọ ni ó ń gba owó ní ìpele ${f.round}.`,
    turnLater: (f) => `Àyè ${f.me.slot} ni tìrẹ. Ó ku ìpele ${f.me.roundsUntilTurn} kí o tó gba nǹkan bí ${amount(f.potFull - f.me.orderFee)}.`,
    miss: (f) => `Tí o kò bá san, a ó yọ ${amount(f.contribution)} kúrò nínú owó ìdúró rẹ, o sì máa pàdánù ìpín rẹ nínú owó èrè.`,
    safety: () => 'Kò sí ẹni tó ń mú owó náà dání. Àdéhùn orí ẹ̀rọ (contract) ni ó ń san owó fún ẹni tí ìgbà rẹ̀ bá tó; kò sí ẹni tó lè yọ owó náà.',
    fees: (f) => `Owó èrè tó wà: ${amount(f.feePool)}. Àwọn tó gba owó ní kùtùkùtù ni ó ń san án; àwọn tó dúró pẹ́ ni ó ń jẹ èrè jù.`,
    reminder: (f) => `${f.name}, ìpele ${f.round}: ${list(f.unpaid)}, ẹ jọ̀wọ́ ẹ san ${amount(f.contribution)}. Ó ku ${humanDuration(f.timeLeftNs)}.`,
    report: (f, r) => `Ìpele ${r.round}: ${short(r.recipient)} ti gba ${amount(r.paid)}.${r.missed.length ? ` ${list(r.missed)} kò san; owó ìdúró ni ó san án.` : ' Gbogbo ènìyàn san.'}`,
  },
};

const phrases = (lang) => T[lang] ?? T.en;

/** Answer one intent from facts, in the given language. Deterministic: no model involved. */
export function answerFromFacts(facts, intent, lang = 'en') {
  const t = phrases(lang);
  const running = facts.status === STATUS.ACTIVE;
  switch (intent) {
    case 'unpaid':
      if (!running) return t.notRunning(facts);
      return facts.unpaid.length ? t.unpaid(facts) : t.allPaid(facts);
    case 'turn':
      if (!facts.me) return t.noMember(facts);
      if (facts.me.paidOut) return t.turnDone(facts);
      if (running && facts.me.isRecipient) return t.turnNow(facts);
      return t.turnLater(facts);
    case 'miss': return t.miss(facts);
    case 'safety': return t.safety(facts);
    case 'fees': return t.fees(facts);
    default:
      if (!running) return t.notRunning(facts);
      return facts.unpaid.length ? t.unpaid(facts) : t.allPaid(facts);
  }
}

/** Note the agent posts while a round is open (max 280 characters, the contract's limit). */
export function reminderNote(facts, lang = 'en') {
  if (facts.status !== STATUS.ACTIVE || facts.unpaid.length === 0) return null;
  return phrases(lang).reminder(facts).slice(0, 280);
}

/** Note the agent posts after a round is paid. `record` is an entry of circle.rounds. */
export function roundReport(circle, record, lang = 'en') {
  const facts = circleFacts(circle, { now: record.at_ns });
  return phrases(lang).report(facts, record).slice(0, 280);
}

/** JSON-safe facts for prompts and API payloads. */
export function factsForPrompt(facts) {
  return JSON.parse(JSON.stringify(facts, (key, v) => {
    if (typeof v !== 'bigint') return v;
    return key === 'timeLeftNs' ? humanDuration(v) : amount(v);
  }));
}

/** The system prompt that keeps the model on the facts. */
export function systemPrompt(lang = 'en') {
  return [
    'You are Alajo, the coordinator of a rotating savings circle (ajo / esusu) that runs on a NEAR smart contract.',
    `Reply in ${LANGUAGES[lang] ?? 'English'}${lang === 'pcm' ? ' (Nigerian Pidgin)' : ''}. Keep it under 70 words, warm and plain. No markdown.`,
    'Use ONLY the facts in the JSON you are given. Never invent amounts, names or deadlines. If the facts do not answer the question, say what you can see instead.',
    'You cannot move money: you can only remind members, report on rounds and settle a round after its deadline. Never claim otherwise.',
  ].join(' ');
}
