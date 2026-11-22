import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';

import { PhotoHead } from '../components/Art.jsx';
import { Cta, Eyebrow } from '../components/ui.jsx';
import { authMessage, captureRef, resetPassword, signInWithEmail, signInWithGoogle, signUpWithEmail } from '../lib/community.js';
import { useCommunity } from '../lib/communityStore.jsx';
import { useApp } from '../lib/store.jsx';

function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

/** Google or email sign-in. A visitor who came through /r/<code> is credited to the inviter on sign-up. */
export function SignInPage() {
  const { configured, user, ready } = useCommunity();
  const { toast } = useApp();
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const [mode, setMode] = useState('signup');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const invited = search.get('ref');
  const formRef = useRef(null);

  useEffect(() => { if (invited) captureRef(invited); }, [invited]);
  useEffect(() => { if (ready && user) navigate('/community', { replace: true }); }, [ready, user, navigate]);

  // Invited visitors came to sign up: bring the Google button and email form into view
  // straight away (after the router's own scroll-to-top on navigation has run).
  const scrolled = useRef(false);
  useEffect(() => {
    if (!invited || !configured || !ready || user || scrolled.current) return undefined;
    scrolled.current = true;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const timer = setTimeout(() => formRef.current?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' }), 300);
    return () => clearTimeout(timer);
  }, [invited, configured, ready, user]);

  async function run(key, fn) {
    setBusy(key);
    setError(null);
    try { await fn(); } catch (e) { setError(authMessage(e)); } finally { setBusy(null); }
  }

  if (!configured) {
    return (
      <PhotoHead photo="community" position="45% 40%">
        <Eyebrow>Community</Eyebrow>
        <h1 className="display">Sign-in is being set up</h1>
        <p className="subtitle">Community accounts open as soon as the Firebase project is connected. Everything else in Ajo Bridge works without an account.</p>
      </PhotoHead>
    );
  }

  return (
    <>
      <PhotoHead photo="community" position="45% 40%">
        <Eyebrow>{invited ? 'You were invited' : 'Join the community'}</Eyebrow>
        <h1 className="display">{mode === 'signin' ? 'Welcome back' : 'Join Ajo Bridge'}</h1>
        <p className="subtitle">An account gives you your own invite link and shows how many friends you have brought in. Your email is never shown to anyone.</p>
      </PhotoHead>
      <section ref={formRef} className="section section--tight on-panel signin-form">
        <div className="wrap stack stack--lg" style={{ maxWidth: '34rem' }}>
          {invited ? <p className="label">You were invited. Create your account to join.</p> : null}
          <button type="button" className="google-btn" onClick={() => run('google', signInWithGoogle)} disabled={Boolean(busy)}>
            <GoogleMark /> <span>{busy === 'google' ? 'Opening Google…' : 'Continue with Google'}</span>
          </button>
          <p className="or"><span>or with email</span></p>
          <form
            className="stack"
            onSubmit={(event) => {
              event.preventDefault();
              run('email', () => (mode === 'signup' ? signUpWithEmail(name, email, password) : signInWithEmail(email, password)));
            }}
          >
            {mode === 'signup' ? (
              <div className="field">
                <label className="field__label" htmlFor="su-name">Your name</label>
                <input id="su-name" className="input" autoComplete="name" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
              </div>
            ) : null}
            <div className="field">
              <label className="field__label" htmlFor="su-email">Email</label>
              <input id="su-email" className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="field">
              <label className="field__label" htmlFor="su-password">Password</label>
              <input id="su-password" className="input" type="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} minLength={6} required value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            {error ? <p className="danger" role="alert">{error}</p> : null}
            <Cta type="submit" size="lg" busy={busy === 'email'}>{mode === 'signup' ? 'Create account' : 'Sign in'}</Cta>
          </form>
          <div className="row row--between">
            <button type="button" className="textlink" onClick={() => { setMode(mode === 'signup' ? 'signin' : 'signup'); setError(null); }}>
              {mode === 'signup' ? 'Have an account? Sign in' : 'New here? Create an account'}
            </button>
            {mode === 'signin' ? (
              <button type="button" className="textlink" onClick={() => run('reset', async () => { if (!email) throw new Error('Type your email first.'); await resetPassword(email); toast('Password reset email sent.'); })}>
                Forgot password?
              </button>
            ) : null}
          </div>
          <p className="helper">By signing up you agree that Ajo Bridge stores your account ID and invite code. Your name and photo appear in the community only if you switch that on. You can sign out at any time.</p>
        </div>
      </section>
    </>
  );
}
