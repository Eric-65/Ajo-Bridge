import { useMemo } from 'react';
import { useNavigate } from 'react-router';

import { slotTable, walkAwayPayoff } from '@shared/ajoMath.js';
import { parseNear } from '@shared/units.js';

import { HalftoneArt } from '../components/Art.jsx';
import { SavingsRing } from '../components/SavingsRing.jsx';
import { SlotPicker } from '../components/SlotPicker.jsx';
import { Ticker } from '../components/Ticker.jsx';
import { Accordion, Cta, Eyebrow, HighlightHeading, Scramble, SegmentBar, Skeleton, Stat } from '../components/ui.jsx';
import { near, percent, roundLength } from '../lib/format.js';
import { useApp, useCircle, useCircles } from '../lib/store.jsx';

const HERO_MEMBERS = ['A', 'B', 'C', 'D', 'E', 'F'].map((label) => ({ label, state: 'due' }));
const EXAMPLE = { n: 5, contribution: parseNear('20'), coverageBps: 10000, orderFeeBps: 100 };

function OpenCircle({ summary }) {
  const { account } = useApp();
  const { data: circle } = useCircle(summary.id);
  const navigate = useNavigate();
  if (!circle) return <Skeleton lines={4} />;
  const filled = circle.slots.filter(Boolean).length;
  return (
    <div className="stack stack--lg">
      <div className="stack">
        <p className="label">Next circle filling · {circle.name}</p>
        <SegmentBar total={circle.n} current={filled + 1} label={`${filled} of ${circle.n} slots taken`} />
        <p className="helper">{filled} of {circle.n} slots taken · {near(circle.contribution)} NEAR every {roundLength(circle.round_ns)} · {percent(circle.coverage_bps)} coverage</p>
      </div>
      <SlotPicker circle={circle} account={account} onTake={() => navigate(`/circle/${circle.id}`, { viewTransition: true })} limit={4} />
      <p className="helper">Leave any time before the circle starts and everything is refunded.</p>
    </div>
  );
}

export function LandingPage() {
  const { data: circles } = useCircles();
  const open = circles?.find((c) => c.status === 'OPEN');
  const active = circles?.find((c) => c.status === 'ACTIVE') ?? circles?.[0];
  const { data: activeCircle } = useCircle(active?.id ?? 0);
  const table = useMemo(() => slotTable(EXAMPLE), []);
  const walk = useMemo(() => walkAwayPayoff(EXAMPLE, 1), []);

  const steps = [
    {
      title: 'Lock',
      summary: 'Pick your payout slot and lock collateral for it.',
      body: (
        <>
          <div className="stack">
            <p className="subtitle">Early slots lock more, the last slot locks one contribution.</p>
            <p className="lede">Getting paid early is a loan from the group. So the earlier your slot, the more you lock: exactly what you will still owe after your payout.</p>
          </div>
          <dl className="facts">
            {table.map((q) => (
              <div key={q.slot}><dt>Slot {q.slot} of 5, at 20 NEAR a round</dt><dd>Lock {near(q.collateral)} NEAR</dd></div>
            )).filter((_, i) => i === 0 || i === 2 || i === 4)}
          </dl>
        </>
      ),
    },
    {
      title: 'Contribute',
      summary: 'Everyone pays in each round, from any chain.',
      body: (
        <>
          <div className="stack">
            <p className="subtitle">USDC on Base, USDT on Tron, SOL. It lands as NEAR.</p>
            <p className="lede">Family abroad can pay into a circle back home. A backer can also put up a member&apos;s collateral: diaspora backs, home borrows.</p>
          </div>
          <dl className="facts">
            <div><dt>Cross-chain route</dt><dd>NEAR Intents 1Click</dd></div>
            <div><dt>If you miss a round</dt><dd>Your collateral pays it</dd></div>
          </dl>
        </>
      ),
    },
    {
      title: 'Collect',
      summary: 'When the last member pays, the pot goes out in the same transaction.',
      body: (
        <>
          <div className="stack">
            <p className="subtitle">No collector holds the money. The contract pays the round&apos;s recipient.</p>
            <p className="lede">Members who wait longer earn the order fee paid by members who collect early. At the end every honest member gets their collateral back.</p>
          </div>
          <dl className="facts">
            <div><dt>Slot 1 pays</dt><dd>{near(table[0].fee)} NEAR order fee</dd></div>
            <div><dt>Slot 5 earns</dt><dd>{near(table[4].feeShare)} NEAR for waiting</dd></div>
          </dl>
        </>
      ),
    },
  ];

  return (
    <>
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero__art"><HalftoneArt variant="wave" /></div>
        <div className="wrap hero__grid">
          <div className="hero__ring">
            <SavingsRing
              members={HERO_MEMBERS}
              autoplay
              centerLabel="Pot"
              ariaLabel="Animation: six members each send a coin into the pot, then the whole pot flows to one member. The recipient changes every round."
            />
          </div>
          <div className="hero__copy">
            <Eyebrow>Ajo · Esusu · Susu, on NEAR</Eyebrow>
            <Scramble as="h1" className="display" text="Save in a circle. Nobody runs with the pot." />
            <p className="subtitle">A rotating savings circle where the contract is the collector, and the member paid first cannot walk away with a gain.</p>
            <div className="hero__actions">
              <Cta to="/create" size="lg" pull>Start a circle</Cta>
              <Cta to={`/circle/${active?.id ?? 0}`} size="lg" variant="dark">Open the demo circle</Cta>
            </div>
          </div>
        </div>
      </section>

      <Ticker entries={activeCircle?.history?.slice(-14).reverse() ?? []} />

      <section className="section section--tight">
        <div className="wrap split">
          {open ? <OpenCircle summary={open} /> : <div className="hatch" style={{ minHeight: '12rem' }} />}
          <div className="stack reveal">
            <p className="tab">How the order works</p>
            <p className="lede">Slots are first come, first served. The circle starts by itself when every slot is taken and fully backed. Nobody joins after that.</p>
            <Cta to="/circles" variant="dark" className="cta--auto">See all circles</Cta>
          </div>
        </div>
      </section>

      <section className="section section--tight" aria-labelledby="promise">
        <div className="wrap stack stack--lg">
          <p className="tab tab--wide" id="promise">The promise</p>
          <div className="card reveal">
            <div className="card__body card__body--split">
              <div className="stack stack--lg">
                <Eyebrow>What stops someone running?</Eyebrow>
                <HighlightHeading parts={['[Nobody,]', '[not the collector,]', '[not slot one.]', 'Can run with the pot.']} />
              </div>
              <p className="subtitle">The member paid first has already locked what they still owe. If they stop paying, the contract pays the group from that lock, round by round.</p>
            </div>
          </div>
          <dl className="facts reveal">
            <div><dt>Who holds the money</dt><dd>A contract with no withdraw function</dd></div>
            <div><dt>Who can settle a late round</dt><dd>Anyone, after the deadline</dd></div>
            <div><dt>What the AI coordinator can do</dt><dd>Remind, report and settle. Never move funds.</dd></div>
          </dl>
        </div>
      </section>

      <section className="section--flush" aria-label="How it works">
        <div className="wrap" style={{ paddingBlock: 'var(--s-6)' }}><p className="tab">How it works</p></div>
        <Accordion items={steps} />
      </section>

      <section className="panels" aria-label="Who it is for">
        <article className="panel">
          <div className="panel__art"><HalftoneArt variant="dunes" /></div>
          <div className="wrap panel__copy">
            <p className="panel__kicker">Lagos · London · Houston</p>
            <h2 className="title">Diaspora backs, home borrows</h2>
            <p className="subtitle">Vouch for someone back home by putting up their collateral. Your stake is on the line before theirs.</p>
            <Cta to={`/circle/${open?.id ?? 1}`}>Back a member</Cta>
          </div>
        </article>
        <article className="panel">
          <div className="panel__art"><HalftoneArt variant="rain" /></div>
          <div className="wrap panel__copy">
            <p className="panel__kicker">Base · Solana · Tron</p>
            <h2 className="title">Pay from any chain</h2>
            <p className="subtitle">Hold USDC on Base or USDT on Tron? See a live quote and pay your round without bridging by hand.</p>
            <Cta to={`/circle/${active?.id ?? 0}?pay=1`}>See a live quote</Cta>
          </div>
        </article>
      </section>

      <section className="section on-soft" aria-labelledby="numbers">
        <div className="wrap stack stack--lg">
          <div className="stack">
            <p className="label" id="numbers">The walk-away test, 5 members at 20 NEAR</p>
            <Scramble className="display" text="Collect first, then vanish. What do you gain?" />
          </div>
          <div className="stats">
            <Stat label="Pot collected" value={99.2} format={(n) => n.toFixed(2)} unit="NEAR" note="Slot 1 is paid 100 minus the order fee." />
            <Stat label="Collateral slashed" value={80} format={(n) => n.toFixed(0)} unit="NEAR" danger note="Four missed rounds, taken from the lock." />
            <Stat label="Walker's net" value={Number(walk.net) / 1e24} format={(n) => n.toFixed(2)} unit="NEAR" danger note="Paid 20, got 99.20, lost 80. Nothing gained." />
            <Stat label="Others made whole" value={100} format={(n) => n.toFixed(0)} unit="%" note="Every other member still gets a full pot." />
          </div>
          <Cta to="/simulator" size="lg" note="5 rounds, step by step">Run the test</Cta>
        </div>
      </section>

      <section className="section on-mint" aria-label="Summary">
        <div className="wrap stack stack--lg">
          <Eyebrow plain>— Which means</Eyebrow>
          <p className="mint-statement reveal">
            We don&apos;t ask you to trust the collector.{' '}
            <span className="hl">We</span> <span className="hl">removed</span> <span className="hl">the</span> <span className="hl">collector.</span>
          </p>
          <Cta to="/create" variant="dark" size="lg">Start a circle</Cta>
        </div>
      </section>
    </>
  );
}
