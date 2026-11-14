import { Cta, Eyebrow, Scramble, SegmentBar, Skeleton } from '../components/ui.jsx';
import { near, percent, roundLength } from '../lib/format.js';
import { useApp, useCircles } from '../lib/store.jsx';

const STATUS_LABEL = { OPEN: 'Filling', ACTIVE: 'Running', AWAITING_FINALIZE: 'Ready to close', COMPLETED: 'Completed' };

export function CirclesPage() {
  const { mode } = useApp();
  const { data: circles, error, loading } = useCircles();
  return (
    <>
      <section className="section section--tight on-black">
        <div className="wrap stack">
          <Eyebrow>{mode === 'testnet' ? 'NEAR testnet contract' : 'Demo data, running in your browser'}</Eyebrow>
          <Scramble as="h1" className="display" text="Circles" />
          <p className="subtitle">Join one that is filling, or follow one that is running.</p>
        </div>
      </section>
      <section className="section section--tight">
        <div className="wrap stack stack--lg">
          {loading && !circles ? <Skeleton lines={5} /> : null}
          {error ? <p className="danger">Could not load circles: {String(error.message ?? error)}</p> : null}
          {circles?.length === 0 ? <div className="card"><p className="subtitle">No circles yet. Start the first one.</p></div> : null}
          <div className="stack stagger">
            {circles?.map((c, i) => (
              <article key={c.id} className="card" style={{ '--i': i }}>
                <div className="card__body card__body--split">
                  <div className="stack">
                    <div className="row">
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
                    <p className="helper">
                      {c.status === 'OPEN' ? `${c.joined} of ${c.members} slots taken` : `Round ${Math.min(c.round, c.members)} of ${c.members}`}
                      {' · '}{near(c.contribution)} NEAR every {roundLength(c.round_ns)} · {percent(c.coverage_bps)} coverage · {percent(c.order_fee_bps)} order fee
                    </p>
                  </div>
                  <Cta to={`/circle/${c.id}`}>{c.status === 'OPEN' ? 'Pick a slot' : 'Open circle'}</Cta>
                </div>
              </article>
            ))}
          </div>
          <Cta to="/create" variant="dark" size="lg">Start a circle</Cta>
        </div>
      </section>
    </>
  );
}
