import { PhotoHead } from '../components/Art.jsx';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';

import { LIMITS } from '@shared/ajoEngine.js';
import { slotTable } from '@shared/ajoMath.js';
import { parseNear } from '@shared/units.js';

import { CollateralBars } from '../components/CollateralBars.jsx';
import { Cta, Eyebrow, NetLabel, Scramble } from '../components/ui.jsx';
import { near } from '../lib/format.js';
import { useApp } from '../lib/store.jsx';

const ROUNDS = [
  { secs: 120, label: '2 min', hint: 'For demos' },
  { secs: 86400, label: '1 day', hint: 'Daily ajo' },
  { secs: 604800, label: '1 week', hint: 'Weekly' },
  { secs: 2592000, label: '30 days', hint: 'Monthly' },
];

function safeNear(text) {
  try { return parseNear(text); } catch { return 0n; }
}

export function CreatePage() {
  const { act, mode, toast } = useApp();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [members, setMembers] = useState(5);
  const [contribution, setContribution] = useState('20');
  const [roundSecs, setRoundSecs] = useState(604800);
  const [coverageBps, setCoverageBps] = useState(10000);
  const [feeBps, setFeeBps] = useState(100);
  const [busy, setBusy] = useState(false);

  const amount = safeNear(contribution);
  const valid = amount > 0n && members >= LIMITS.MIN_MEMBERS && members <= LIMITS.MAX_MEMBERS;
  const table = useMemo(
    () => (valid ? slotTable({ n: members, contribution: amount, coverageBps, orderFeeBps: feeBps }) : []),
    [valid, members, amount, coverageBps, feeBps],
  );

  async function submit(event) {
    event.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    try {
      const fx = await act('create_circle', {
        name: name.trim() || 'My circle', members, contribution: amount.toString(), round_secs: roundSecs,
        coverage_bps: coverageBps, order_fee_bps: feeBps,
      });
      toast('Circle created. Pick your slot.');
      if (fx.value !== null && fx.value !== undefined) navigate(`/circle/${fx.value}`, { viewTransition: true });
      else navigate('/circles', { viewTransition: true });
    } catch (error) {
      toast(error.message ?? String(error), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PhotoHead photo="thinker" position="50% 35%">
        <Eyebrow>New circle</Eyebrow>
        <Scramble as="h1" className="display" text="Set the rules once. The contract keeps them." />
      </PhotoHead>
      <section className="section section--tight on-panel">
        <form className="wrap split" onSubmit={submit} noValidate>
          <div className="stack stack--lg">
            <div className="field">
              <label className="field__label" htmlFor="name">Circle name</label>
              <input id="name" className="input" value={name} maxLength={LIMITS.MAX_NAME_LENGTH} placeholder="e.g. Family Savings" aria-describedby="name-hint" onChange={(e) => setName(e.target.value)} />
              <span className="field__hint" id="name-hint">
                Any name you like, such as Lagos Family, Uni Friends or Rent Fund. Up to {LIMITS.MAX_NAME_LENGTH} characters
                {name.length > 0 ? ` (${LIMITS.MAX_NAME_LENGTH - name.length} left)` : ''}. Everyone can see it and it cannot be changed later.
              </span>
            </div>
            <div className="grid-2">
              <div className="field">
                <label className="field__label" htmlFor="members">Members</label>
                <input id="members" className="input" type="number" inputMode="numeric" min={LIMITS.MIN_MEMBERS} max={LIMITS.MAX_MEMBERS} required value={members} onChange={(e) => setMembers(Number(e.target.value))} />
                <span className="field__hint">{LIMITS.MIN_MEMBERS} to {LIMITS.MAX_MEMBERS}. One payout each.</span>
              </div>
              <div className="field">
                <label className="field__label" htmlFor="contribution">Contribution (NEAR)</label>
                <input id="contribution" className="input" inputMode="decimal" pattern="\d+(\.\d+)?" required value={contribution} onChange={(e) => setContribution(e.target.value)} />
                <span className="field__hint">Per member, per round.</span>
              </div>
            </div>
            <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="field__label" style={{ marginBottom: '0.5rem' }}>Round length</legend>
              <div className="choice">
                {ROUNDS.map((r) => (
                  <label key={r.secs}>
                    <input type="radio" name="round" checked={roundSecs === r.secs} onChange={() => setRoundSecs(r.secs)} />
                    <b>{r.label}</b><small>{r.hint}</small>
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="field__label" style={{ marginBottom: '0.5rem' }}>Who is in this circle?</legend>
              <div className="choice">
                <label>
                  <input type="radio" name="coverage" checked={coverageBps === 10000} onChange={() => setCoverageBps(10000)} />
                  <b>Strangers · 100%</b><small>Nobody can lose money to a member who walks away.</small>
                </label>
                <label>
                  <input type="radio" name="coverage" checked={coverageBps === 5000} onChange={() => setCoverageBps(5000)} />
                  <b>Friends · 50%</b><small>Half the collateral. The group carries the rest of the risk.</small>
                </label>
              </div>
            </fieldset>
            <div className="field">
              <label className="field__label" htmlFor="fee">Order fee · {(feeBps / 100).toFixed(2)}%</label>
              <input id="fee" className="range" type="range" min={0} max={500} step={25} value={feeBps} onChange={(e) => setFeeBps(Number(e.target.value))} />
              <span className="field__hint">Paid by members who collect early, shared by members who wait. 0% turns it off.</span>
            </div>
          </div>

          <div className="stack stack--lg">
            <div className="card">
              <div className="stack">
                <Eyebrow>Collateral per slot</Eyebrow>
                {valid ? <CollateralBars table={table} /> : <p className="subtitle danger">Enter a contribution and 2 to 12 members.</p>}
                {valid ? (
                  <dl className="facts">
                    <div><dt>Pot each round</dt><dd>{near(table[0].pot)} NEAR</dd></div>
                    <div><dt>First slot locks / last slot locks</dt><dd>{near(table[0].collateral)} / {near(table.at(-1).collateral)} NEAR</dd></div>
                    <div><dt>Last slot earns for waiting</dt><dd>{near(table.at(-1).feeShare)} NEAR</dd></div>
                  </dl>
                ) : null}
              </div>
            </div>
            <NetLabel net={mode === 'testnet' ? 'testnet' : 'demo'}>
              {mode === 'testnet' ? 'Creates the circle on the NEAR testnet contract. A small storage fee is attached.' : 'Creates a circle in the demo only. Leave the demo (grey banner) to create a real one on testnet.'}
            </NetLabel>
            <Cta type="submit" size="lg" busy={busy} disabled={!valid || undefined} pull>Create circle</Cta>
          </div>
        </form>
      </section>
    </>
  );
}
