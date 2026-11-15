/**
 * Ajo Bridge community: Google or email sign-in (Firebase Auth), a unique invite
 * link per user, referral counts and an opt-in public profile wall (Firestore).
 * The data model and its security rules are in /firestore.rules.
 *
 * Firebase is loaded on demand, so pages that never touch the community do not
 * download it. Configuration is public by design (Firebase web config is not a
 * secret); access control lives in the security rules.
 */

const env = import.meta.env;
const EMULATOR = env.VITE_FIREBASE_EMULATOR === '1';

const CONFIG = EMULATOR
  ? { apiKey: 'demo-key', authDomain: 'localhost', projectId: env.VITE_FIREBASE_PROJECT_ID || 'demo-ajo', appId: 'demo-app' }
  : {
    apiKey: env.VITE_FIREBASE_API_KEY,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: env.VITE_FIREBASE_PROJECT_ID,
    appId: env.VITE_FIREBASE_APP_ID,
  };

export const communityConfigured = Boolean(CONFIG.apiKey && CONFIG.authDomain && CONFIG.projectId && CONFIG.appId);

const REF_KEY = 'ajo-ref';
const CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

/** Remember an invite code from the URL (?ref=code) until the visitor signs up. */
export function captureRef(code) {
  const clean = String(code ?? '').toLowerCase();
  if (!/^[a-z0-9]{7}$/.test(clean)) return null;
  try { localStorage.setItem(REF_KEY, clean); } catch { /* private mode: the link still opens */ }
  return clean;
}
const pendingRef = () => { try { return localStorage.getItem(REF_KEY); } catch { return null; } };
const clearRef = () => { try { localStorage.removeItem(REF_KEY); } catch { /* ignore */ } };

export const inviteLink = (code) => `${window.location.origin}/r/${code}`;

let sdk = null;
async function load() {
  if (!communityConfigured) throw new Error('Community sign-in is not configured yet.');
  if (sdk) return sdk;
  const [app, auth, fs] = await Promise.all([import('firebase/app'), import('firebase/auth'), import('firebase/firestore')]);
  const firebaseApp = app.initializeApp(CONFIG);
  const authInstance = auth.getAuth(firebaseApp);
  const db = fs.getFirestore(firebaseApp);
  if (EMULATOR) {
    auth.connectAuthEmulator(authInstance, 'http://127.0.0.1:9099', { disableWarnings: true });
    fs.connectFirestoreEmulator(db, '127.0.0.1', 8080);
  }
  sdk = { auth, fs, authInstance, db };
  return sdk;
}

// ------------------------------------------------------------------ auth

export async function watchUser(callback) {
  if (!communityConfigured) { callback(null); return () => {}; }
  const { auth, authInstance } = await load();
  return auth.onAuthStateChanged(authInstance, callback);
}

const AUTH_MESSAGES = {
  'auth/popup-closed-by-user': 'The Google window was closed before signing in.',
  'auth/cancelled-popup-request': 'The Google window was closed before signing in.',
  'auth/invalid-credential': 'That email and password do not match.',
  'auth/wrong-password': 'That email and password do not match.',
  'auth/user-not-found': 'No account with that email. Create one instead.',
  'auth/email-already-in-use': 'An account with that email already exists. Sign in instead.',
  'auth/weak-password': 'Use a password of at least 6 characters.',
  'auth/invalid-email': 'That email address does not look right.',
  'auth/too-many-requests': 'Too many attempts. Wait a minute and try again.',
  'auth/unauthorized-domain': 'This site is not on the Firebase authorized domains list yet.',
  'auth/network-request-failed': 'Network problem. Check your connection and try again.',
};
export const authMessage = (error) => AUTH_MESSAGES[error?.code] ?? String(error?.message ?? error);

export async function signInWithGoogle() {
  const { auth, authInstance } = await load();
  const provider = new auth.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    return (await auth.signInWithPopup(authInstance, provider)).user;
  } catch (error) {
    // Some in-app browsers block popups: fall back to a full-page redirect.
    if (error?.code === 'auth/popup-blocked' || error?.code === 'auth/operation-not-supported-in-this-environment') {
      await auth.signInWithRedirect(authInstance, provider);
      return null;
    }
    throw error;
  }
}

export async function signUpWithEmail(name, email, password) {
  const { auth, authInstance } = await load();
  const { user } = await auth.createUserWithEmailAndPassword(authInstance, email, password);
  if (name) await auth.updateProfile(user, { displayName: name.trim().slice(0, 60) });
  return user;
}

export async function signInWithEmail(email, password) {
  const { auth, authInstance } = await load();
  return (await auth.signInWithEmailAndPassword(authInstance, email, password)).user;
}

export async function resetPassword(email) {
  const { auth, authInstance } = await load();
  await auth.sendPasswordResetEmail(authInstance, email);
}

export async function logOut() {
  const { auth, authInstance } = await load();
  await auth.signOut(authInstance);
}

// ------------------------------------------------------------------ account set-up

function randomCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(7));
  return [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

/**
 * Called after every sign-in. On the first one it creates, in one atomic batch:
 * a unique invite code, the private account record, the anonymous "joined"
 * marker and, when the visitor arrived through someone's link, the referral.
 * Returns the account record.
 */
export async function ensureAccount(user) {
  const { fs, db } = await load();
  const userRef = fs.doc(db, 'users', user.uid);
  const existing = await fs.getDoc(userRef);
  if (existing.exists()) return { uid: user.uid, ...existing.data() };

  let inviter = null;
  const ref = pendingRef();
  if (ref) {
    const owner = await fs.getDoc(fs.doc(db, 'refCodes', ref)).catch(() => null);
    const inviterUid = owner?.exists() ? owner.data().uid : null;
    if (inviterUid && inviterUid !== user.uid) inviter = { uid: inviterUid, code: ref };
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomCode();
    const batch = fs.writeBatch(db);
    batch.set(fs.doc(db, 'refCodes', code), { uid: user.uid });
    batch.set(userRef, { refCode: code, referredBy: inviter?.code ?? null, showInCommunity: false, createdAt: fs.serverTimestamp() });
    batch.set(fs.doc(db, 'members', user.uid), { joinedAt: fs.serverTimestamp() });
    if (inviter) batch.set(fs.doc(db, 'referrals', user.uid), { by: inviter.uid, createdAt: fs.serverTimestamp() });
    try {
      await batch.commit();
      clearRef();
      return { uid: user.uid, refCode: code, referredBy: inviter?.code ?? null, showInCommunity: false };
    } catch (error) {
      // A code collision shows up as permission-denied on refCodes: try another code.
      if (error?.code !== 'permission-denied' || attempt === 4) throw error;
    }
  }
  throw new Error('Could not create your invite code. Try again.');
}

/** Show or hide the signed-in user's Google name and photo on the community wall. */
export async function setShowInCommunity(user, show) {
  const { fs, db } = await load();
  const profileRef = fs.doc(db, 'profiles', user.uid);
  if (show) {
    const member = await fs.getDoc(fs.doc(db, 'members', user.uid));
    await fs.setDoc(profileRef, {
      displayName: (user.displayName || user.email?.split('@')[0] || 'Ajo member').slice(0, 60),
      photoURL: user.photoURL && user.photoURL.startsWith('https://') ? user.photoURL.slice(0, 500) : null,
      joinedAt: member.exists() ? member.data().joinedAt : fs.Timestamp.now(),
    });
  } else {
    await fs.deleteDoc(profileRef);
  }
  await fs.updateDoc(fs.doc(db, 'users', user.uid), { showInCommunity: show });
}

// ------------------------------------------------------------------ reads

/** Total sign-ups (anonymous count of members/*). */
export async function countMembers() {
  const { fs, db } = await load();
  return (await fs.getCountFromServer(fs.collection(db, 'members'))).data().count;
}

/** The people who joined through this user's link: total, plus those who show a public profile. */
export async function myReferrals(uid) {
  const { fs, db } = await load();
  const q = fs.query(fs.collection(db, 'referrals'), fs.where('by', '==', uid));
  const [count, docs] = await Promise.all([fs.getCountFromServer(q), fs.getDocs(fs.query(q, fs.limit(50)))]);
  const profiles = await Promise.all(docs.docs.map(async (d) => {
    const p = await fs.getDoc(fs.doc(db, 'profiles', d.id));
    return p.exists() ? { uid: d.id, ...p.data() } : null;
  }));
  return { count: count.data().count, publicProfiles: profiles.filter(Boolean) };
}

/** Members who chose to show their profile, newest first. */
export async function listProfiles(max = 60) {
  const { fs, db } = await load();
  const snap = await fs.getDocs(fs.query(fs.collection(db, 'profiles'), fs.orderBy('joinedAt', 'desc'), fs.limit(max)));
  return snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
}
