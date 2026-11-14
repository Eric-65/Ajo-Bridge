import { useState } from 'react';

import { PhotoHead } from '../components/Art.jsx';
import { Cta, Eyebrow, Scramble, SegmentBar, Skeleton } from '../components/ui.jsx';
import { near, percent, roundLength } from '../lib/format.js';
import { useApp, useCircles } from '../lib/store.jsx';

const STATUS_LABEL = { OPEN: 'Filling', ACTIVE: 'Running', AWAITING_FINALIZE: 'Ready to close', COMPLETED: 'Completed' };

const FILTERS = [
  { key: 'ALL', label: 'All' },
  { key: 'OPEN', label: 'Open' },
  { key: 'ACTIVE', label: 'Active' },
  { key: 'DONE', label: 'Completed' },
];
const matches = (filter, status) => filter === 'ALL' || (filter === 'DONE' ? status === 'COMPLETED' || status === 'AWAITING_FINALIZE' : status === filter);

export function CirclesPage() {
  const { mode } = useApp();
  const { data: circles, error, loading } = useCircles();
  const [filter, setFilter] = useState('ALL');
  const shown = circles?.filter((c) => matches(filter, c.status)) ?? [];
  return (
    <>
      <PhotoHead photo="roots" position="40% 30%">
        <Eyebrow>{mode === 'testnet' ? 'Live · read from ajobridge-circles.testnet' : 'Demo data, running in your browser'}</Eyebrow>
        <Scramble as="h1" className="display" text="Circles" />
        <p className="subtitle">Savings circles are centuries old. These ones keep their own books. Join one that is filling, or follow one that is running.</p>
      </PhotoHead>
      <section className="section section--tight">
        <div className="wrap stack stack--lg">
          <div className="filters" role="group" aria-label="Filter circles">
            {FILTERS.map((f) => (
              <button key={f.key} type="button" className="filter" aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>
                {f.label}{circles ? ` · ${circles.filter((c) => matches(f.key, c.status)).length}` : ''}
              </button>
            ))}
          </div>
          {loading && !circles ? <Skeleton lines={5} /> : null}
          {error ? <p className="danger" role="alert">Could not load circles from NEAR testnet: {String(error.message ?? error)}</p> : null}
          {circles && circles.length === 0 ? (
            <div className="card"><div className="stack"><p className="title">No circles yet</p><p className="subtitle">Start the first one.</p><Cta to="/create" className="cta--auto">Start a circle</Cta></div></div>
          ) : null}
          {circles && circles.length > 0 && shown.length === 0 ? <p className="subtitle">No circles in this filter.</p> : null}
          <div className="stack stagger">
            {shown.map((c, i) => {
              const open = c.members - c.joined;
              return (
                <article key={c.id} className="card" style={{ '--i': i }}>
                  <div className="card__body">
                    <div className="row row--between">
                      <span className={`tag ${c.status === 'OPEN' ? 'tag--mint' : c.status === 'ACTIVE' ? 'tag--dark' : ''}`}>{STATUS_LABEL[c.status]}</span>
                      <span className="helper">Circle #{c.id}</span>
                    </div>
                    <h2 className="title">{c.name}</h2>
                    <SegmentBar
                      total={c.members}
                      current={c.status === 'OPEN' ? c.joined + 1 : c.round}
                      done={c.status === 'AWAITING_FINALIZE' || c.status === 'COMPLETED'}
                      label={c.status === 'OPEN' ? `${c.joined} of ${c.members} slots taken` : `Round ${c.round} of ${c.members}`}
                    />
                    <dl className="card-facts">
                      <div><dt>Contribution</dt><dd>{near(c.contribution)} NEAR / {roundLength(c.round_ns)}</dd></div>
                      <div><dt>Members</dt><dd>{c.joined} / {c.members}</dd></div>
                      <div><dt>Open slots</dt><dd>{c.status === 'OPEN' ? open : 0}</dd></div>
                      <div><dt>Round</dt><dd>{c.status === 'OPEN' ? 'Not started' : c.status === 'ACTIVE' ? `${c.round} of ${c.members}` : 'Finished'}</dd></div>
                    </dl>
                    <p className="helper">{percent(c.coverage_bps)} coverage · {percent(c.order_fee_bps)} order fee</p>
                    <Cta to={`/circle/${c.id}`}>{c.status === 'OPEN' ? `Pick a slot · ${open} open` : 'Open circle'}</Cta>
                  </div>
                </article>
              );
            })}
          </div>
          <Cta to="/create" variant="dark" size="lg">Start a circle</Cta>
        </div>
      </section>
    </>
  );
}
