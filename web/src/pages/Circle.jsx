import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';

import { STATUS, collateralOf, currentRecipient, membersInSlotOrder, minReserve, requiredCollateral, vouchedTotal } from '@shared/ajoEngine.js';

import { AlajoDrawer } from '../components/AlajoDrawer.jsx';
import { PayDrawer } from '../components/PayDrawer.jsx';
import { SavingsRing } from '../components/SavingsRing.jsx';
import { SlotPicker } from '../components/SlotPicker.jsx';
import { CountUp, Cta, Drawer, Eyebrow, Meter, NetLabel, Scramble, SegmentBar, Skeleton, Stat } from '../components/ui.jsx';
import { EXPLORER_URL } from '../lib/config.js';
import { demo } from '../lib/demoStore.js';
import { describeEvent, duration, initial, near, percent, roundLength, shortName, when } from '../lib/format.js';
import { useApp, useCircle, useNow } from '../lib/store.jsx';
import { burst, flyChip, glitch } from '../motion/effects.js';

const STATUS_TEXT = {
  OPEN: 'Filling: pick a slot',
  ACTIVE: 'Running',
  AWAITING_FINALIZE: 'All rounds paid: ready to close',
  COMPLETED: 'Completed',
};

const toNumber = (yocto) => Number(BigInt(yocto) / 10n ** 20n) / 1e4;

function memberState(circle, member, now) {
  if (circle.status !== STATUS.ACTIVE) return member.paid_out ? 'paid' : 'due';
  if (member.slot === circle.round) return 'recipient';
  if (member.last_paid_round === circle.round) return 'paid';
  return now > circle.deadline_ns ? 'late' : 'due';
}

function JoinDrawer({ circle, slot, onClose, onConfirm, busy }) {
  const required = requiredCollateral(circle, slot);
  const reserve = minReserve(circle, slot);
  const [plan, setPlan] = useState('full');
  const deposit = plan === 'full' ? required : reserve;
  return (
    <Drawer title={`Take slot ${slot}`} onClose={onClose}>
      <p className="helper">You are paid in round {slot} of {circle.n}. After that you still owe {circle.n - slot} more contribution{circle.n - slot === 1 ? '' : 's'}, which is what this collateral covers. It comes back at the end if you never miss.</p>
      <div className="choice">
        <label>
          <input type="radio" name="plan" checked={plan === 'full'} onChange={() => setPlan('full')} />
          <b>Lock it all · {near(required)} NEAR</b><small>You are fully backed straight away.</small>
        </label>
        <label>
          <input type="radio" name="plan" checked={plan === 'reserve'} onChange={() => setPlan('reserve')} />
          <b>Reserve · {near(reserve)} NEAR</b><small>Hold the slot with 10%. A backer vouches for the other {near(required - reserve)}.</small>
        </label>
      </div>
      <Cta size="lg" busy={busy} onClick={() => onConfirm(deposit)}>Lock {near(deposit)} NEAR</Cta>
    </Drawer>
  );
}

function VouchDrawer({ circle, member, onClose, onConfirm, busy }) {
  const gap = requiredCollateral(circle, member.slot) - collateralOf(member);
  const [amount, setAmount] = useState(near(gap, 2));
  let value = 0n;
  try { value = BigInt(Math.round(Number(amount) * 1e6)) * 10n ** 18n; } catch { value = 0n; }
  return (
    <Drawer title={`Back ${shortName(member.account)}`} onClose={onClose}>
      <p className="helper">You put up part of {shortName(member.account)}&apos;s collateral for slot {member.slot}. If they miss a payment, <b>your stake is slashed before theirs</b>. Whatever is left returns to you when the circle closes. You can withdraw until the circle starts.</p>
      <div className="field">
        <label className="field__label" htmlFor="vouch-amount">Amount to vouch (NEAR)</label>
        <input id="vouch-amount" className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <span className="field__hint">Still missing: {near(gap)} NEAR. Anything above that is sent straight back.</span>
      </div>
      <Cta size="lg" busy={busy} disabled={value <= 0n || undefined} onClick={() => onConfirm(value)}>Vouch {amount || '0'} NEAR</Cta>
    </Drawer>
  );
}

function ShareRow({ circle, openSlots, toast, lateList }) {
  const link = `${window.location.origin}/c/${circle.id}`;
  const invite = openSlots > 0
    ? `Join my savings circle "${circle.name}" on Ajo Bridge: ${near(circle.contribution)} NEAR per round, ${openSlots} slot${openSlots === 1 ? '' : 's'} open. Nobody can run with the pot. ${link}`
    : `Follow our savings circle "${circle.name}" on Ajo Bridge: ${link}`;
  const remind = lateList.length
    ? `Reminder for "${circle.name}", round ${circle.round}: ${lateList.map((a) => shortName(a)).join(', ')}, please pay ${near(circle.contribution)} NEAR. ${link}`
    : null;
  const copy = async () => {
    try { await navigator.clipboard.writeText(link); toast('Invite link copied.'); } catch { toast(link); }
  };
  return (
    <div className="share-row" style={{ marginTop: 'var(--s-3)' }}>
      <Cta size="sm" className="cta--auto" href={`https://wa.me/?text=${encodeURIComponent(invite)}`} target="_blank" rel="noreferrer">Share on WhatsApp</Cta>
      <Cta size="sm" variant="dark" className="cta--auto" onClick={copy}>Copy invite link</Cta>
      {remind ? <Cta size="sm" variant="dark" className="cta--auto" href={`https://wa.me/?text=${encodeURIComponent(remind)}`} target="_blank" rel="noreferrer">Remind late members</Cta> : null}
    </div>
  );
}

export function CirclePage() {
  const { id } = useParams();
  const [search, setSearch] = useSearchParams();
  const { data: circle, error, loading } = useCircle(id);
  const { account, act, mode, toast, lastEffects, walletAccount, connect, connecting } = useApp();
  const now = useNow();
  const [busy, setBusy] = useState(null);
  const [joinSlot, setJoinSlot] = useState(null);
  const [vouchFor, setVouchFor] = useState(null);
  const [alajoOpen, setAlajoOpen] = useState(false);
  const ringRef = useRef(null);
  const rowRefs = useRef({});
  const payOpen = search.get('pay') === '1';

  const effects = lastEffects && String(lastEffects.circleId) === String(id) ? lastEffects : null;

  // Slash and payout choreography on the member list (the ring plays its own coins).
  useEffect(() => {
    if (!effects) return;
    const paid = effects.events.find((e) => e.event === 'round_paid');
    const slashes = effects.events.filter((e) => e.event === 'member_slashed' || e.event === 'voucher_slashed');
    slashes.forEach((e, i) => {
      setTimeout(() => {
        const from = rowRefs.current[e.data.account];
        glitch(from);
        if (paid && BigInt(e.data.amount ?? 0) > 0n) flyChip(from, rowRefs.current[paid.data.account], `−${near(e.data.amount)}`);
      }, 250 + i * 420);
    });
    if (paid) setTimeout(() => burst(rowRefs.current[paid.data.account] ?? ringRef.current?.pot()), 900 + slashes.length * 420);
  }, [effects?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const members = useMemo(() => (circle ? membersInSlotOrder(circle) : []), [circle]);
  useEffect(() => {
    if (circle && window.location.hash === '#slots') document.getElementById('slots')?.scrollIntoView({ block: 'start' });
  }, [Boolean(circle)]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error && !circle) {
    return <section className="section"><div className="wrap stack"><h1 className="display">Circle not found</h1><p className="danger">{String(error.message ?? error)}</p><Cta to="/circles" className="cta--auto">All circles</Cta></div></section>;
  }
  if (loading && !circle) return <section className="section"><div className="wrap"><Skeleton lines={6} /></div></section>;

  const me = account ? circle.members[account] : null;
  const recipient = currentRecipient(circle);
  const active = circle.status === STATUS.ACTIVE;
  const pastDeadline = active && now > circle.deadline_ns;
  const potFull = BigInt(circle.n) * circle.contribution;
  const locked = members.reduce((sum, m) => sum + collateralOf(m), 0n);
  const myVouches = members.filter((m) => m.vouches.some((v) => v.voucher === account && v.amount > 0n));
  const needBacking = circle.status === STATUS.OPEN ? members.filter((m) => collateralOf(m) < requiredCollateral(circle, m.slot)) : [];
  const iPaid = me && me.last_paid_round === circle.round;
  const unpaidList = members.filter((m) => active && m.last_paid_round < circle.round && m.slot !== circle.round).map((m) => m.account);

  async function run(key, method, args = {}, deposit = 0n, done, plain = 'Done.') {
    if (busy) return;
    setBusy(key);
    try {
      const fx = await act(method, { circle_id: Number(id), ...args }, deposit);
      const paid = fx.events.find((e) => e.event === 'round_paid');
      const started = fx.events.find((e) => e.event === 'circle_started');
      toast(done ?? (paid ? `Round paid: ${near(paid.data.amount)} NEAR to ${shortName(paid.data.account)}.` : started ? 'All slots backed. The circle has started.' : plain));
    } catch (e) {
      toast(e.message ?? String(e), 'error');
    } finally {
      setBusy(null);
    }
  }

  const ringMembers = circle.slots.map((holder, i) => {
    if (!holder) return { label: '+', name: `Slot ${i + 1}`, state: 'empty' };
    return { label: initial(holder), name: shortName(holder), state: memberState(circle, circle.members[holder], now) };
  });
  const ringLabel = `Savings circle ${circle.name}. ${circle.slots.map((holder, i) => (holder ? `Slot ${i + 1}: ${shortName(holder)}, ${ringMembers[i].state}` : `Slot ${i + 1}: open`)).join('. ')}.`;

  return (
    <>
      <section className="section section--tight on-black">
        <div className="wrap split">
          <div className="stack">
            <div className="row">
              <span className={`tag ${active ? 'tag--mint' : 'tag--line'}`}>{STATUS_TEXT[circle.status]}</span>
              <NetLabel net={mode === 'testnet' ? 'testnet' : 'demo'}>Circle #{circle.id}</NetLabel>
            </div>
            <Scramble as="h1" className="display" text={circle.name} />
            <p className="subtitle">{near(circle.contribution)} NEAR every {roundLength(circle.round_ns)} · {circle.n} members · {percent(circle.coverage_bps)} coverage · {percent(circle.order_fee_bps)} order fee</p>
            <ShareRow circle={circle} openSlots={circle.slots.filter((x) => !x).length} toast={toast} lateList={active && pastDeadline ? unpaidList : []} />
            <div className="stack stack--sm" style={{ marginTop: 'var(--s-3)' }}>
              <p className="label">{circle.status === STATUS.OPEN ? `${members.length} of ${circle.n} slots taken` : active ? `Round ${circle.round} of ${circle.n}` : 'All rounds complete'}</p>
              <SegmentBar total={circle.n} current={circle.status === STATUS.OPEN ? members.length + 1 : circle.round} done={!active && circle.status !== STATUS.OPEN} />
            </div>
            {active ? (
              <dl className="facts" style={{ marginTop: 'var(--s-3)' }}>
                <div><dt>This round pays</dt><dd>{shortName(recipient.account)}{recipient.account === account ? ' (you)' : ''}</dd></div>
                <div>
                  <dt>{pastDeadline ? 'Deadline passed' : 'Time left to pay'}</dt>
                  <dd className={pastDeadline ? 'danger tnum' : 'tnum'} aria-live="off">{pastDeadline ? 'Anyone can settle now' : duration(circle.deadline_ns - now)}</dd>
                </div>
              </dl>
            ) : null}
          </div>
          <div className="hero__ring">
            <SavingsRing
              ref={ringRef}
              members={ringMembers}
              accounts={circle.slots}
              effects={effects}
              fill={active ? Number((circle.pot * 100n) / potFull) / 100 : 0}
              centerLabel={active ? 'In the pot' : circle.status === STATUS.OPEN ? 'Pot per round' : 'Paid out'}
              centerValue={near(active ? circle.pot : potFull)}
              ariaLabel={ringLabel}
            />
          </div>
        </div>
      </section>

      <section className="section section--tight" aria-label="Actions">
        <div className="wrap stack stack--lg">
          {circle.status === STATUS.OPEN ? (
            <>
              <p className="tab" id="slots">Pick your payout slot</p>
              {mode === 'testnet' && !walletAccount ? (
                <div className="card card--dark"><div className="stack">
                  <p className="subtitle" style={{ color: '#e6e6e6' }}>You are viewing live data. Connect a NEAR testnet wallet to take a slot.</p>
                  <Cta onClick={connect} busy={connecting} className="cta--auto">Connect wallet</Cta>
                </div></div>
              ) : null}
              <SlotPicker circle={circle} account={account} busySlot={busy === 'join' ? joinSlot : null} onTake={setJoinSlot} />
              <p className="helper">Earlier slots lock more collateral and pay the order fee. Later slots lock less and earn it. The circle starts when every slot is taken and fully backed.</p>
              {needBacking.length ? (
                <div className="card">
                  <div className="stack">
                    <Eyebrow>Waiting for a backer</Eyebrow>
                    {needBacking.map((m) => {
                      const gap = requiredCollateral(circle, m.slot) - collateralOf(m);
                      const mine = m.account === account;
                      return (
                        <div key={m.account} className="row row--between">
                          <p className="subtitle">Slot {m.slot} · {shortName(m.account)} needs {near(gap)} NEAR more</p>
                          {mine
                            ? <Cta size="sm" className="cta--auto" busy={busy === 'topup'} onClick={() => run('topup', 'join', { slot: m.slot }, gap, 'Collateral added.')}>Add {near(gap)} NEAR myself</Cta>
                            : <Cta size="sm" className="cta--auto" onClick={() => setVouchFor(m)}>Vouch for {shortName(m.account)}</Cta>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}
              <div className="row">
                {me ? <Cta variant="dark" size="sm" className="cta--auto" busy={busy === 'leave'} onClick={() => run('leave', 'leave', {}, 0n, 'You left. Your collateral was refunded.')}>Leave and refund</Cta> : null}
                {myVouches.map((m) => (
                  <Cta key={m.account} variant="dark" size="sm" className="cta--auto" busy={busy === 'cancel'} onClick={() => run('cancel', 'cancel_vouch', { member: m.account }, 0n, 'Vouch withdrawn and refunded.')}>
                    Withdraw vouch for {shortName(m.account)}
                  </Cta>
                ))}
              </div>
            </>
          ) : null}

          {active ? (
            <div className="split split--even">
              <div className="stack">
                <p className="tab">Your move</p>
                {!me ? <p className="subtitle">You are not a member of this circle. You can still settle a late round.</p> : null}
                {me ? (
                  iPaid
                    ? <Cta size="lg" done>Paid for round {circle.round}</Cta>
                    : <Cta size="lg" pull busy={busy === 'contribute'} onClick={() => run('contribute', 'contribute', {}, circle.contribution, null, `You paid ${near(circle.contribution)} NEAR for round ${circle.round}.`)} note={`${near(circle.contribution)} NEAR`}>Contribute</Cta>
                ) : null}
                <Cta variant="dark" onClick={() => setSearch({ pay: '1' })} note="USDC · USDT · SOL">Pay from any chain</Cta>
                <p className="helper">{me && !iPaid ? `If you miss the deadline, ${near(circle.contribution)} NEAR is taken from your collateral and you lose your share of the fee pool.` : 'When the last member pays, the pot is sent in the same transaction.'}</p>
              </div>
              <div className="stack">
                <p className="tab">Settle the round</p>
                <Cta variant={pastDeadline ? undefined : 'dark'} disabled={!pastDeadline || undefined} busy={busy === 'settle'} onClick={() => run('settle', 'settle_round')}>
                  {pastDeadline ? 'Settle round now' : `Settle opens in ${duration(circle.deadline_ns - now)}`}
                </Cta>
                <p className="helper">After the deadline anyone can settle. Members who have not paid are slashed and {shortName(recipient.account)} is paid from what is covered.</p>
                {mode === 'demo' && !pastDeadline ? (
                  <Cta variant="ghost" size="sm" onClick={() => { demo.skipToDeadline(Number(id)); toast('Demo clock moved past the deadline.'); }}>Demo only: skip to the deadline</Cta>
                ) : null}
              </div>
            </div>
          ) : null}

          {circle.status === STATUS.AWAITING_FINALIZE ? (
            <div className="stack">
              <p className="tab">Close the circle</p>
              <Cta size="lg" busy={busy === 'finalize'} onClick={() => run('finalize', 'finalize', {}, 0n, 'Circle closed. Collateral refunded and the fee pool shared out.')}>Refund collateral and share fees</Cta>
              <p className="helper">Anyone can call this. It returns remaining collateral to members and vouchers and pays out the fee pool.</p>
            </div>
          ) : null}

          {circle.status === STATUS.COMPLETED ? (
            <div className="card card--dark">
              <div className="stack">
                <Eyebrow>Closed</Eyebrow>
                <p className="display">Everyone has been paid.</p>
                <p className="subtitle">{circle.shortfall > 0n ? `The group ended ${near(circle.shortfall)} NEAR short because coverage was below 100%.` : 'No shortfall. All collateral is back with its owners.'}</p>
              </div>
            </div>
          ) : null}
        </div>
      </section>

      <section className="section section--tight on-soft" aria-label="Circle numbers">
        <div className="wrap stats">
          <Stat label={active ? 'In the pot' : 'Pot per round'} value={toNumber(active ? circle.pot : potFull)} format={(n) => n.toFixed(n % 1 ? 2 : 0)} unit="NEAR" note={active ? `of ${near(potFull)} this round` : `${circle.n} × ${near(circle.contribution)}`} />
          <Stat label="Collateral locked" value={toNumber(locked)} format={(n) => n.toFixed(n % 1 ? 2 : 0)} unit="NEAR" note="Members plus vouchers" />
          <Stat label="Fee pool" value={toNumber(circle.fee_pool)} format={(n) => n.toFixed(2)} unit="NEAR" note="Shared by waiting time at the end" />
          <Stat label="Shortfall" value={toNumber(circle.shortfall)} format={(n) => n.toFixed(2)} unit="NEAR" danger={circle.shortfall > 0n} note={circle.shortfall > 0n ? 'Owed to short-paid members' : 'Nobody is owed anything'} />
        </div>
      </section>

      <section className="section section--tight" aria-labelledby="members-title">
        <div className="wrap stack stack--lg">
          <p className="tab" id="members-title">Members</p>
          <ul className="members stagger">
            {circle.slots.map((holder, i) => {
              if (!holder) {
                return <li key={`open-${i}`} className="member hatch" style={{ '--i': i }}><p className="member__name"><span className="member__slot">{String(i + 1).padStart(2, '0')}</span>Open slot</p></li>;
              }
              const m = circle.members[holder];
              const state = memberState(circle, m, now);
              const required = requiredCollateral(circle, m.slot);
              const paidRounds = Number(m.contributed / circle.contribution);
              return (
                <li key={holder} ref={(el) => { rowRefs.current[holder] = el; }} className="member" data-state={state} data-me={holder === account} style={{ '--i': i }}>
                  <div className="member__top">
                    <p className="member__name"><span className="member__slot">{String(m.slot).padStart(2, '0')}</span>{shortName(holder)}</p>
                    <span className="row" style={{ gap: '0.3rem', flexWrap: 'nowrap' }}>
                      {state === 'recipient' ? <span className="tag tag--mint">Collects</span> : null}
                      {state === 'paid' && active ? <span className="tag">Paid</span> : null}
                      {state === 'due' && active ? <span className="tag tag--line">To pay</span> : null}
                      {state === 'late' ? <span className="tag tag--red">Late</span> : null}
                      {m.defaulted ? <span className="tag tag--red">Missed {m.missed}</span> : null}
                      {m.paid_out ? <span className="tag tag--dark">Paid out</span> : null}
                    </span>
                  </div>
                  <dl className="member__grid">
                    <div><dt>Collateral</dt><dd>{near(collateralOf(m))} / {near(required)}</dd></div>
                    <div><dt>Vouched by</dt><dd>{vouchedTotal(m) > 0n ? `${m.vouches.map((v) => shortName(v.voucher)).join(', ')} · ${near(vouchedTotal(m))}` : '—'}</dd></div>
                    <div><dt>Rounds paid</dt><dd><Meter total={circle.n} filled={paidRounds} late={m.missed} /> <span className="sr-only">{paidRounds} paid, {m.missed} missed</span></dd></div>
                    <div><dt>{m.slashed + m.vouch_slashed > 0n ? 'Slashed' : 'Received'}</dt><dd className={m.slashed + m.vouch_slashed > 0n ? 'danger' : undefined}>{near(m.slashed + m.vouch_slashed > 0n ? m.slashed + m.vouch_slashed : m.received)} NEAR</dd></div>
                  </dl>
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      <section className="section section--tight on-dark" aria-labelledby="alajo-title">
        <div className="wrap split">
          <div className="stack">
            <Eyebrow>AI coordinator</Eyebrow>
            <h2 className="display" id="alajo-title">Alajo</h2>
            <p className="subtitle">Reads the circle, reminds members, writes round reports and settles late rounds. Its key cannot move money.</p>
            <Cta className="cta--auto" onClick={() => setAlajoOpen(true)}>Ask Alajo</Cta>
          </div>
          <div className="stack">
            <p className="label">Notes from Alajo</p>
            {circle.notes.length === 0 ? <p className="helper">No notes yet.</p> : null}
            {circle.notes.slice(-3).reverse().map((note, i) => (
              <blockquote key={i} className="chat__msg" data-from="alajo" style={{ maxWidth: 'none' }}>
                {note.text}
                <footer className="helper" style={{ marginTop: '0.4rem' }}>Round {note.r} · {when(note.t)}</footer>
              </blockquote>
            ))}
          </div>
        </div>
      </section>

      <section className="section section--tight" aria-labelledby="history-title">
        <div className="wrap stack">
          <p className="tab tab--wide" id="history-title">History</p>
          <div className="history">
            {circle.history.slice().reverse().slice(0, 14).map((entry, i) => {
              const item = describeEvent(entry);
              return (
                <div key={i} className="history__row" data-kind={item.kind}>
                  <span className="history__when">Round {item.round} · {when(item.at)}</span>
                  <span className="history__amt">{item.amount && item.amount !== '0' ? <CountUp value={toNumber(item.amount)} format={(n) => n.toFixed(n % 1 ? 2 : 0)} duration={700} /> : ''}</span>
                  <span className="history__what">{item.text} <span className="history__who">· {item.who}</span></span>
                </div>
              );
            })}
          </div>
          {mode === 'testnet' ? <p className="helper">Every row is a NEP-297 event logged by the contract. <a href={`${EXPLORER_URL}`} target="_blank" rel="noreferrer" style={{ textDecoration: 'underline' }}>Open the testnet explorer</a></p> : null}
        </div>
      </section>

      {joinSlot ? (
        <JoinDrawer
          circle={circle}
          slot={joinSlot}
          busy={busy === 'join'}
          onClose={() => setJoinSlot(null)}
          onConfirm={(deposit) => run('join', 'join', { slot: joinSlot }, deposit, `Slot ${joinSlot} is yours.`).then(() => setJoinSlot(null))}
        />
      ) : null}
      {vouchFor ? (
        <VouchDrawer
          circle={circle}
          member={vouchFor}
          busy={busy === 'vouch'}
          onClose={() => setVouchFor(null)}
          onConfirm={(amount) => run('vouch', 'vouch', { member: vouchFor.account }, amount, `You are backing ${shortName(vouchFor.account)}.`).then(() => setVouchFor(null))}
        />
      ) : null}
      {payOpen ? <PayDrawer circle={circle} onClose={() => setSearch({})} /> : null}
      {alajoOpen ? <AlajoDrawer circle={circle} onClose={() => setAlajoOpen(false)} /> : null}
    </>
  );
}
