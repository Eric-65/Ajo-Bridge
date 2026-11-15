import { useCallback, useEffect, useState } from 'react';

import { PhotoHead } from '../components/Art.jsx';
import { CountUp, Cta, Eyebrow, Skeleton } from '../components/ui.jsx';
import { countMembers, inviteLink, listProfiles, myReferrals, setShowInCommunity } from '../lib/community.js';
import { useCommunity } from '../lib/communityStore.jsx';
import { useApp } from '../lib/store.jsx';

const joined = (ts) => (ts?.toDate ? ts.toDate().toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '');

function Avatar({ name, photo, size = 'md' }) {
  const [broken, setBroken] = useState(false);
  const letter = (name || '?').trim()[0]?.toUpperCase() ?? '?';
  return (
    <span className={`avatar avatar--${size}`} aria-hidden="true">
      {photo && !broken ? <img src={photo} alt="" referrerPolicy="no-referrer" loading="lazy" onError={() => setBroken(true)} /> : letter}
    </span>
  );
}

function InviteCard({ user, account }) {
  const { toast } = useApp();
  const { setAccount } = useCommunity();
  const [refs, setRefs] = useState(null);
  const [saving, setSaving] = useState(false);
  const link = inviteLink(account.refCode);
  const message = `I'm saving with Ajo Bridge: a savings circle on NEAR where nobody can run off with the pot. Join me: ${link}`;

  useEffect(() => { myReferrals(user.uid).then(setRefs).catch(() => setRefs({ count: 0, publicProfiles: [], error: true })); }, [user.uid]);

  const copy = async () => {
    try { await navigator.clipboard.writeText(link); toast('Invite link copied.'); } catch { toast(link); }
  };
  const toggle = async () => {
    setSaving(true);
    try {
      await setShowInCommunity(user, !account.showInCommunity);
      setAccount({ ...account, showInCommunity: !account.showInCommunity });
      toast(account.showInCommunity ? 'Your profile is hidden from the community.' : 'Your profile now shows in the community.');
    } catch (e) {
      toast(String(e?.message ?? e), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card card--dark">
      <div className="card__body">
        <div className="row" style={{ gap: '0.8rem' }}>
          <Avatar name={user.displayName || user.email} photo={user.photoURL} size="lg" />
          <div className="stack stack--sm" style={{ minWidth: 0 }}>
            <p className="title" style={{ overflowWrap: 'anywhere' }}>{user.displayName || user.email?.split('@')[0]}</p>
            <p className="helper">Signed in {user.providerData?.[0]?.providerId === 'google.com' ? 'with Google' : 'with email'}</p>
          </div>
        </div>

        <div className="stack stack--sm">
          <p className="label">You invited</p>
          <p className="numeral mint">{refs ? <CountUp value={refs.count} /> : '…'}</p>
          <p className="helper">{refs?.count === 1 ? 'person has joined through your link.' : 'people have joined through your link.'}</p>
          {refs?.publicProfiles?.length ? (
            <div className="avatar-row">{refs.publicProfiles.map((p) => <Avatar key={p.uid} name={p.displayName} photo={p.photoURL} size="sm" />)}</div>
          ) : null}
        </div>

        <div className="stack stack--sm">
          <p className="label">Your invite link</p>
          <div className="copy"><code>{link}</code><button type="button" onClick={copy}>Copy</button></div>
          <div className="share-row">
            <Cta size="sm" className="cta--auto" href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer">Share on WhatsApp</Cta>
            <Cta size="sm" variant="dark" className="cta--auto" href={`https://x.com/intent/post?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer">Share on X</Cta>
          </div>
        </div>

        <label className="switch">
          <input type="checkbox" checked={Boolean(account.showInCommunity)} disabled={saving} onChange={toggle} />
          <span className="switch__track" aria-hidden="true" />
          <span><b>Show me in the community</b><br /><small>Your {user.providerData?.[0]?.providerId === 'google.com' ? 'Google ' : ''}name and photo appear on the wall below. Your email never does.</small></span>
        </label>
      </div>
    </div>
  );
}

export function CommunityPage() {
  const { configured, user, account, ready, error, signOut } = useCommunity();
  const [members, setMembers] = useState(null);
  const [profiles, setProfiles] = useState(null);
  const [loadError, setLoadError] = useState(null);

  const load = useCallback(() => {
    if (!configured) return;
    Promise.all([countMembers(), listProfiles()])
      .then(([count, list]) => { setMembers(count); setProfiles(list); setLoadError(null); })
      .catch((e) => setLoadError(String(e?.message ?? e)));
  }, [configured]);
  useEffect(() => { load(); }, [load, account?.showInCommunity, user?.uid]);

  return (
    <>
      <PhotoHead photo="community" position="45% 40%">
        <Eyebrow>Community</Eyebrow>
        <h1 className="display">
          {members === null ? 'The people saving together' : <><CountUp value={members} /> {members === 1 ? 'person has' : 'people have'} joined</>}
        </h1>
        <p className="subtitle">Everyone who signs up is counted here. Invite your friends with your own link and watch the circle grow.</p>
      </PhotoHead>

      <section className="section section--tight">
        <div className="wrap stack stack--lg">
          {!configured ? <div className="card"><p className="subtitle">Community sign-in is being set up. Circles, the walk-away test and the wallet all work without an account.</p></div> : null}
          {configured && !ready ? <Skeleton lines={3} /> : null}
          {configured && ready && !user ? (
            <div className="card card--dark"><div className="card__body">
              <p className="title">Get your invite link</p>
              <p className="subtitle" style={{ color: '#d6d6d6' }}>Sign in with Google or email to get a personal link and see how many friends you bring in.</p>
              <Cta to="/signin" size="lg">Join the community</Cta>
            </div></div>
          ) : null}
          {error ? <p className="danger" role="alert">{error}</p> : null}
          {user && account ? <InviteCard user={user} account={account} /> : null}
          {user && !account && !error ? <Skeleton lines={3} /> : null}
          {user ? <button type="button" className="textlink" onClick={signOut}>Sign out</button> : null}

          {configured ? (
            <div className="stack">
              <p className="tab">Members who show their profile</p>
              {loadError ? <p className="danger">Could not load the community: {loadError}</p> : null}
              {profiles === null && !loadError ? <Skeleton lines={2} /> : null}
              {profiles && profiles.length === 0 ? <p className="subtitle">No public profiles yet. Be the first: sign in and switch on "Show me in the community".</p> : null}
              <ul className="wall stagger">
                {profiles?.map((p, i) => (
                  <li key={p.uid} className="wall__item" style={{ '--i': i }}>
                    <Avatar name={p.displayName} photo={p.photoURL} />
                    <span className="wall__name">{p.displayName}</span>
                    <span className="helper">Joined {joined(p.joinedAt)}</span>
                  </li>
                ))}
              </ul>
              {members !== null && profiles ? <p className="helper">{members} {members === 1 ? 'member' : 'members'} in total; {profiles.length} chose to show their profile.</p> : null}
            </div>
          ) : null}
        </div>
      </section>
    </>
  );
}
