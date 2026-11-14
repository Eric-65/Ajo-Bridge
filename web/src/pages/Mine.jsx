import { PhotoHead } from '../components/Art.jsx';
import { Cta, Eyebrow, SegmentBar, Skeleton } from '../components/ui.jsx';
import { near, shortName } from '../lib/format.js';
import { myStake } from '../lib/stats.js';
import { useAllCircles, useApp } from '../lib/store.jsx';

/** Circles where the connected account is a member or a voucher, with what it owes and when it is paid. */
export function MinePage() {
  const { mode, account, walletAccount, connect, connecting } = useApp();
  const { data: circles, error, loading } = useAllCircles();
  const needsWallet = mode === 'testnet' && !walletAccount;
  const mine = (circles ?? []).map((c) => ({ c, stake: myStake(c, account) })).filter((x) => x.stake);

  return (
    <>
      <PhotoHead photo="thinker" position="50% 35%">
        <Eyebrow>{mode === 'testnet' ? 'Live · NEAR testnet' : `Demo · acting as ${account}`}</Eyebrow>
        <h1 className="display">My circles</h1>
        <p className="subtitle">What you owe this round, when you are paid, and the collateral you have locked.</p>
      </PhotoHead>
      <section className="section section--tight">
        <div className="wrap stack stack--lg">
          {needsWallet ? (
            <div className="card"><div className="stack">
              <p className="title">Connect your wallet</p>
              <p className="subtitle">Your circles are found by your testnet account.</p>
              <Cta onClick={connect} busy={connecting} className="cta--auto">Connect wallet</Cta>
            </div></div>
          ) : null}
          {!needsWallet && loading && !circles ? <Skeleton lines={4} /> : null}
          {error ? <p className="danger" role="alert">Could not load circles: {String(error.message ?? error)}</p> : null}
          {!needsWallet && circles && mine.length === 0 ? (
            <div className="card"><div className="stack">
              <p className="title">You are not in a circle yet</p>
              <p className="subtitle">Take a slot in an open circle or start your own.</p>
              <div className="row"><Cta to="/circles" className="cta--auto">Find a circle</Cta><Cta to="/create" variant="dark" className="cta--auto">Start a circle</Cta></div>
            </div></div>
          ) : null}
          {!needsWallet ? mine.map(({ c, stake }) => (
            <article key={c.id} className="card">
              <div className="card__body">
                <div className="row row--between">
                  <h2 className="title">{c.name}</h2>
                  {stake.owesThisRound ? <span className="tag tag--red">You owe this round</span> : stake.collectsThisRound ? <span className="tag tag--mint">You collect this round</span> : null}
                </div>
                <SegmentBar total={c.n} current={c.status === 'OPEN' ? c.slots.filter(Boolean).length + 1 : c.round} done={c.status === 'COMPLETED' || c.status === 'AWAITING_FINALIZE'} />
                <dl className="card-facts">
                  <div><dt>Your payout round</dt><dd>{stake.payoutRound ? `Round ${stake.payoutRound} of ${c.n}` : '—'}</dd></div>
                  <div><dt>Your collateral</dt><dd>{stake.member ? `${near(stake.collateral)} NEAR` : '—'}</dd></div>
                  <div><dt>This round</dt><dd>{stake.owesThisRound ? `Pay ${near(c.contribution)} NEAR` : stake.member && c.status === 'ACTIVE' ? 'Paid' : '—'}</dd></div>
                  <div><dt>You back</dt><dd>{stake.vouches.length ? stake.vouches.map((v) => `${shortName(v.member)} · ${near(v.amount)}`).join(', ') : '—'}</dd></div>
                </dl>
                <Cta to={`/circle/${c.id}`}>{stake.owesThisRound ? `Pay ${near(c.contribution)} NEAR` : 'Open circle'}</Cta>
              </div>
            </article>
          )) : null}
        </div>
      </section>
    </>
  );
}
