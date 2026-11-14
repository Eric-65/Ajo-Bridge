import { useEffect, useMemo, useRef, useState } from 'react';

import { parseNear } from '@shared/units.js';
import { simulateWalkAway } from '@shared/simulate.js';

import { SavingsRing } from '../components/SavingsRing.jsx';
import { CountUp, Cta, Eyebrow, Scramble, SegmentBar } from '../components/ui.jsx';
import { near, signedNear } from '../lib/format.js';
import { flyChip, glitch } from '../motion/effects.js';
import { reducedMotion } from '../motion/raf.js';

const NAMES = ['ada', 'bayo', 'chidi', 'dupe', 'emeka'];
const N = 5;
const C = parseNear('20');
const toNumber = (yocto) => Number(BigInt(yocto) / 10n ** 20n) / 1e4;

/**
 * Walk-away simulator. Five members, 20 NEAR a round. One member collects the
 * pot and stops paying. Every number on this page comes from shared/simulate.js,
 * which replays the circle through the same engine the contract runs.
 */
export function SimulatorPage() {
  const [coverageBps, setCoverageBps] = useState(10000);
  const [walkerSlot, setWalkerSlot] = useState(1);
  const [backed, setBacked] = useState(false);
  const [step, setStep] = useState(0); // 0 = before round 1, 1..5 = after that round, 6 = ledger
  const [auto, setAuto] = useState(false);
  const barRefs = useRef({});
  const stageRef = useRef(null);

  const sim = useMemo(() => simulateWalkAway({
    n: N, contribution: C, coverageBps, orderFeeBps: 100, walkerSlot, names: NAMES,
    vouches: backed ? [{ slot: walkerSlot, voucher: 'uncle.london', amount: parseNear('40') }] : [],
  }), [coverageBps, walkerSlot, backed]);

  useEffect(() => { setStep(0); setAuto(false); }, [coverageBps, walkerSlot, backed]);

  useEffect(() => {
    if (!auto) return undefined;
    if (step >= N + 1) { setAuto(false); return undefined; }
    const timer = setTimeout(() => setStep((s) => s + 1), reducedMotion() ? 900 : 2600);
    return () => clearTimeout(timer);
  }, [auto, step]);

  const round = step >= 1 && step <= N ? sim.attacked.rounds[step - 1] : null;
  const snapshot = step === 0 ? sim.attacked.start : sim.attacked.rounds[Math.min(step, N) - 1].after;
  const walker = sim.walker;
  const maxCollateral = sim.attacked.start.members.reduce((max, m) => (m.collateral > max ? m.collateral : max), 1n);

  // Slash choreography when a round with a missed payment is revealed.
  useEffect(() => {
    if (!round || round.record.missed.length === 0) return;
    const from = barRefs.current[walker];
    const to = barRefs.current[round.recipient];
    const timer = setTimeout(() => {
      glitch(stageRef.current);
      flyChip(from, to, `−${near(C)}`);
    }, 350);
    return () => clearTimeout(timer);
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  const ringMembers = NAMES.map((name, i) => {
    const slot = i + 1;
    let state = 'due';
    if (round) {
      if (slot === round.round) state = 'recipient';
      else if (round.record.missed.includes(name)) state = 'late';
      else state = 'paid';
    } else if (step > N) state = name === walker ? 'late' : 'paid';
    return { label: name[0].toUpperCase(), name, state };
  });

  const slashedNow = round ? round.events.filter((e) => e.event === 'member_slashed' || e.event === 'voucher_slashed') : [];
  const uncovered = round ? round.events.filter((e) => e.event === 'member_slashed').reduce((sum, e) => sum + BigInt(e.data.uncovered), 0n) : 0n;
  const done = step > N;
  const safe = sim.walkerSideNet <= 0n && sim.othersMadeWhole && sim.shortfall === 0n;

  return (
    <>
      <section className="section section--tight on-black">
        <div className="wrap stack">
          <Eyebrow>The walk-away test</Eyebrow>
          <Scramble as="h1" className="display" text="Collect the pot, then vanish. Watch what happens." />
          <p className="subtitle">Five members, 20 NEAR a round, 1% order fee. Same engine as the contract, running in your browser.</p>
        </div>
      </section>

      <section className="section section--tight on-panel" aria-label="Scenario">
        <div className="wrap split split--even">
          <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="field__label" style={{ marginBottom: '0.5rem' }}>Coverage</legend>
            <div className="choice">
              <label><input type="radio" name="cov" checked={coverageBps === 10000} onChange={() => setCoverageBps(10000)} /><b>Strangers · 100%</b><small>Full collateral</small></label>
              <label><input type="radio" name="cov" checked={coverageBps === 5000} onChange={() => setCoverageBps(5000)} /><b>Friends · 50%</b><small>Half collateral</small></label>
            </div>
          </fieldset>
          <div className="stack">
            <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="field__label" style={{ marginBottom: '0.5rem' }}>Who walks away after being paid?</legend>
              <div className="choice" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}>
                {[1, 2, 3, 4].map((slot) => (
                  <label key={slot}><input type="radio" name="walker" checked={walkerSlot === slot} onChange={() => setWalkerSlot(slot)} /><b>{NAMES[slot - 1]}</b><small>Slot {slot}</small></label>
                ))}
              </div>
            </fieldset>
            <label className="row" style={{ gap: '0.6rem', minHeight: '2.75rem' }}>
              <input type="checkbox" checked={backed} onChange={(e) => setBacked(e.target.checked)} style={{ width: '1.25rem', height: '1.25rem', accentColor: 'var(--ink)' }} />
              <span className="label">A backer abroad vouches 40 NEAR for the walker</span>
            </label>
          </div>
        </div>
      </section>

      <section className="section section--tight on-black" aria-label="Simulation">
        <div className="wrap split" ref={stageRef}>
          <div className="hero__ring">
            <SavingsRing
              members={ringMembers}
              accounts={NAMES}
              effects={round ? { id: step * 100 + coverageBps + walkerSlot, events: round.events } : null}
              fill={0}
              centerLabel={done ? 'Circle closed' : round ? `Round ${round.round}` : 'Ready'}
              centerValue={round ? near(round.record.paid) : done ? '' : near(BigInt(N) * C)}
              ariaLabel={round
                ? `Round ${round.round}: ${round.recipient} collects ${near(round.record.paid)} NEAR. ${round.record.missed.length ? `${round.record.missed.join(', ')} did not pay.` : 'Everyone paid.'}`
                : 'Five members around the pot, before round one.'}
            />
          </div>

          <div className="stack stack--lg">
            <div className="stack stack--sm">
              <p className="label">{done ? 'All five rounds played' : step === 0 ? 'Before round 1' : `Round ${step} of ${N}`}</p>
              <SegmentBar total={N} current={Math.min(step + (step === 0 ? 1 : 0), N)} done={done} label="Simulation progress" />
            </div>

            <div aria-live="polite" className="stack">
              {step === 0 ? (
                <>
                  <h2 className="title">Everyone has locked their collateral.</h2>
                  <p className="subtitle"><b className="mint">{walker}</b> holds slot {walkerSlot} and locked {near(sim.attacked.start.members[walkerSlot - 1].stake)} NEAR{backed ? `, backed by uncle.london with ${near(sim.attacked.start.members[walkerSlot - 1].vouched)} NEAR` : ''}. The plan: pay until the payout, then disappear.</p>
                </>
              ) : null}
              {round ? (
                <>
                  <h2 className="title">{round.recipient} collects <span className="mint">{near(round.record.paid)} NEAR</span></h2>
                  {round.record.missed.length === 0 ? <p className="subtitle">Everyone paid 20 NEAR. Pot {near(round.record.pot)}, order fee {near(round.record.fee)}.</p> : null}
                  {slashedNow.map((e, i) => (BigInt(e.data.amount) > 0n ? (
                    <p key={i} className="subtitle danger">
                      {e.event === 'voucher_slashed' ? `${near(e.data.amount)} NEAR slashed from backer ${e.data.by}` : `${near(e.data.amount)} NEAR slashed from ${e.data.account}'s own collateral`}
                    </p>
                  ) : null))}
                  {uncovered > 0n ? <p className="subtitle danger">{near(uncovered)} NEAR is not covered. {round.recipient} is left short.</p> : null}
                  {round.record.missed.length > 0 && uncovered === 0n ? <p className="subtitle">{walker} did not pay, but the pot is still full.</p> : null}
                </>
              ) : null}
              {done ? (
                <>
                  <h2 className="title">{safe ? 'Walking away earned nothing.' : 'The group was left short.'}</h2>
                  <p className="subtitle">{safe ? 'Collateral paid every missed round. See the ledger below.' : 'This is the cost of coverage below 100%. Switch to Strangers to compare.'}</p>
                </>
              ) : null}
            </div>

            <div className="bars" aria-label="Collateral still locked per member">
              {snapshot.members.map((m) => (
                <div className="bars__row" key={m.account} ref={(el) => { barRefs.current[m.account] = el; }}>
                  <span className="bars__slot" style={{ color: m.account === walker ? 'var(--red)' : '#bdbdbd' }}>{m.account}</span>
                  <div className="bars__track" style={{ background: 'var(--ink-2)' }}>
                    <span className="bars__fill" style={{ background: m.account === walker ? 'var(--red)' : 'var(--white)', transform: `scaleX(${Number((m.collateral * 1000n) / maxCollateral) / 1000})`, transition: 'transform 700ms var(--ease-out)' }} />
                  </div>
                  <span className="bars__value"><CountUp value={toNumber(m.collateral)} format={(n) => n.toFixed(0)} duration={700} /></span>
                </div>
              ))}
              <p className="helper">Collateral still locked (NEAR){backed ? '. The backer\'s stake is used first.' : ''}</p>
            </div>

            <div className="grid-2">
              <Cta size="lg" pull onClick={() => (done ? setStep(0) : setStep(step + 1))}>{done ? 'Run again' : step === 0 ? 'Start round 1' : step === N ? 'See the ledger' : `Play round ${step + 1}`}</Cta>
              <Cta size="lg" variant="dark" onClick={() => setAuto(!auto)} aria-pressed={auto}>{auto ? 'Pause' : 'Auto-play'}</Cta>
            </div>
          </div>
        </div>
      </section>

      {done ? (
        <>
          <section className="section section--tight on-dark" aria-labelledby="ledger-title">
            <div className="wrap stack stack--lg">
              <p className="tab" id="ledger-title">Final ledger</p>
              <div className="table-scroll">
                <table className="ledger">
                  <thead>
                    <tr><th scope="col">Member</th><th scope="col">Net</th><th scope="col">If all honest</th><th scope="col">Paid in</th><th scope="col">Payout</th><th scope="col">Slashed</th><th scope="col">Fee earned</th></tr>
                  </thead>
                  <tbody>
                    {sim.ledger.map((row) => (
                      <tr key={row.account} data-walker={row.isWalker || undefined}>
                        <td>{row.account}{row.isWalker ? ' (walked)' : row.role === 'voucher' ? ' (backer)' : ''}</td>
                        <td data-good={!row.isWalker && row.role === 'member' && row.madeWhole ? 'true' : undefined}>{signedNear(row.net)}</td>
                        <td>{row.role === 'voucher' ? '—' : signedNear(row.baselineNet)}</td>
                        <td>{row.role === 'voucher' ? '—' : near(row.contributed)}</td>
                        <td>{row.role === 'voucher' ? '—' : near(row.received)}</td>
                        <td>{near(row.slashed)}</td>
                        <td>{row.role === 'voucher' ? '—' : near(row.feeEarned)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="helper">Net = everything received from the circle minus everything paid into it, collateral included. Amounts in NEAR. &quot;If all honest&quot; is the same circle with no default.</p>
            </div>
          </section>

          <section className={`section ${safe ? 'on-mint' : 'on-panel'}`} aria-label="Verdict">
            <div className="wrap stack stack--lg">
              <Eyebrow plain>— Verdict</Eyebrow>
              {safe ? (
                <p className="mint-statement">
                  {walker} walked away with{' '}<span className="hl">{signedNear(sim.walkerSideNet)}</span>{' '}<span className="hl">NEAR.</span>{' '}
                  {backed ? 'Counting the backer who vouched. ' : ''}Everyone else was <span className="hl">made</span> <span className="hl">whole.</span>
                </p>
              ) : (
                <p className="mint-statement">
                  {walker} gained <span className="hl" style={{ color: 'var(--red)' }}>{signedNear(sim.walkerNet)}</span>. The group is short{' '}
                  <span className="hl" style={{ color: 'var(--red)' }}>{near(sim.shortfall)}</span> NEAR.
                </p>
              )}
              <p className="subtitle" style={{ textAlign: 'center' }}>
                {safe
                  ? 'With 100% coverage a member who leaves after their payout never ends with a net gain, and no other member loses. This invariant is tested for every circle size and slot.'
                  : 'Friends mode trades safety for cheaper collateral. Use it only with people you would lend to anyway.'}
              </p>
              <Cta to="/create" variant="dark" size="lg">Start a circle with these rules</Cta>
            </div>
          </section>
        </>
      ) : null}
    </>
  );
}
