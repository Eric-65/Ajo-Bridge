/**
 * Security rules for the community (firestore.rules), tested against the Firebase
 * emulators with real signed-in users. Run:  npm run test:community
 * (starts the Auth and Firestore emulators, runs this file, stops them).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../web/package.json', import.meta.url));
const { initializeApp, deleteApp } = require('firebase/app');
const { getAuth, connectAuthEmulator, createUserWithEmailAndPassword, signOut } = require('firebase/auth');
const fs = require('firebase/firestore');

const run = Date.now().toString(36);
let n = 0;
const apps = [];

/** A fresh app instance signed in as a new user (or anonymous when email is null). */
async function client(email) {
  const app = initializeApp({ apiKey: 'demo-key', projectId: 'demo-ajo', appId: 'demo' }, `c${run}${n++}`);
  apps.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  const db = fs.getFirestore(app);
  fs.connectFirestoreEmulator(db, '127.0.0.1', 8080);
  const user = email ? (await createUserWithEmailAndPassword(auth, `${email}-${run}-${n}@example.com`, 'secret123')).user : null;
  return { auth, db, user };
}

const code = () => Math.random().toString(36).slice(2, 9).padEnd(7, 'x').replace(/[^a-z0-9]/g, 'x');

/** The same batch the app writes on first sign-in. */
async function signUp(c, referrer = null) {
  const refCode = code();
  const batch = fs.writeBatch(c.db);
  batch.set(fs.doc(c.db, 'refCodes', refCode), { uid: c.user.uid });
  batch.set(fs.doc(c.db, 'users', c.user.uid), { refCode, referredBy: referrer ? referrer.refCode : null, showInCommunity: false, createdAt: fs.serverTimestamp() });
  batch.set(fs.doc(c.db, 'members', c.user.uid), { joinedAt: fs.serverTimestamp() });
  if (referrer) batch.set(fs.doc(c.db, 'referrals', c.user.uid), { by: referrer.uid, createdAt: fs.serverTimestamp() });
  await batch.commit();
  return { uid: c.user.uid, refCode };
}

const denied = (promise) => assert.rejects(promise, (e) => e.code === 'permission-denied');

test.after(async () => { await Promise.all(apps.map((a) => deleteApp(a))); });

test('sign-up batch works, with and without an inviter', async () => {
  const ada = await client('ada');
  const adaAcc = await signUp(ada);
  const bayo = await client('bayo');
  await signUp(bayo, adaAcc);
  const count = await fs.getCountFromServer(fs.query(fs.collection(ada.db, 'referrals'), fs.where('by', '==', ada.user.uid)));
  assert.equal(count.data().count, 1);
});

test('accounts are private: nobody else can read users/{uid}', async () => {
  const ada = await client('ada'); await signUp(ada);
  const eve = await client('eve'); await signUp(eve);
  await denied(fs.getDoc(fs.doc(eve.db, 'users', ada.user.uid)));
  const anon = await client(null);
  await denied(fs.getDoc(fs.doc(anon.db, 'users', ada.user.uid)));
});

test('member count is public, but signing up as someone else is not allowed', async () => {
  const anon = await client(null);
  const total = await fs.getCountFromServer(fs.collection(anon.db, 'members'));
  assert.ok(total.data().count >= 0);
  const eve = await client('eve');
  await denied(fs.setDoc(fs.doc(eve.db, 'members', 'someone-else'), { joinedAt: fs.serverTimestamp() }));
});

test('referrals cannot be faked: not later, not to yourself, not to a non-member', async () => {
  const ada = await client('ada'); const adaAcc = await signUp(ada);
  const eve = await client('eve'); await signUp(eve);
  // after sign-up: too late to claim an inviter
  await denied(fs.setDoc(fs.doc(eve.db, 'referrals', eve.user.uid), { by: adaAcc.uid, createdAt: fs.serverTimestamp() }));
  // self-referral at sign-up
  const sam = await client('sam');
  const samCode = code();
  const batch = fs.writeBatch(sam.db);
  batch.set(fs.doc(sam.db, 'refCodes', samCode), { uid: sam.user.uid });
  batch.set(fs.doc(sam.db, 'users', sam.user.uid), { refCode: samCode, referredBy: samCode, showInCommunity: false, createdAt: fs.serverTimestamp() });
  batch.set(fs.doc(sam.db, 'members', sam.user.uid), { joinedAt: fs.serverTimestamp() });
  batch.set(fs.doc(sam.db, 'referrals', sam.user.uid), { by: sam.user.uid, createdAt: fs.serverTimestamp() });
  await denied(batch.commit());
  // inviter who is not a member
  const tom = await client('tom');
  await denied(signUp(tom, { uid: 'not-a-member', refCode: 'zzzzzzz' }));
});

test('only the inviter can read their referrals', async () => {
  const ada = await client('ada'); const adaAcc = await signUp(ada);
  const bayo = await client('bayo'); await signUp(bayo, adaAcc);
  const eve = await client('eve'); await signUp(eve);
  await denied(fs.getDoc(fs.doc(eve.db, 'referrals', bayo.user.uid)));
  await denied(fs.getCountFromServer(fs.query(fs.collection(eve.db, 'referrals'), fs.where('by', '==', ada.user.uid))));
});

test('invite code and inviter cannot be changed after sign-up; only the show-profile switch can', async () => {
  const ada = await client('ada'); await signUp(ada);
  await denied(fs.updateDoc(fs.doc(ada.db, 'users', ada.user.uid), { refCode: 'aaaaaaa' }));
  await denied(fs.updateDoc(fs.doc(ada.db, 'users', ada.user.uid), { referredBy: 'bbbbbbb' }));
  await fs.updateDoc(fs.doc(ada.db, 'users', ada.user.uid), { showInCommunity: true });
});

test('a second invite code cannot be claimed once the account exists', async () => {
  const ada = await client('ada'); await signUp(ada);
  await denied(fs.setDoc(fs.doc(ada.db, 'refCodes', code()), { uid: ada.user.uid }));
});

test('public profiles: owner only, no extra fields (no email), https photos only, removable', async () => {
  const ada = await client('ada'); await signUp(ada);
  const eve = await client('eve'); await signUp(eve);
  const ref = fs.doc(ada.db, 'profiles', ada.user.uid);
  await denied(fs.setDoc(ref, { displayName: 'Ada', photoURL: null, joinedAt: fs.Timestamp.now(), email: 'ada@example.com' }));
  await denied(fs.setDoc(ref, { displayName: 'Ada', photoURL: 'javascript:alert(1)', joinedAt: fs.Timestamp.now() }));
  await denied(fs.setDoc(fs.doc(eve.db, 'profiles', ada.user.uid), { displayName: 'Not Ada', photoURL: null, joinedAt: fs.Timestamp.now() }));
  await fs.setDoc(ref, { displayName: 'Ada', photoURL: 'https://example.com/a.png', joinedAt: fs.Timestamp.now() });
  const anon = await client(null);
  assert.equal((await fs.getDoc(fs.doc(anon.db, 'profiles', ada.user.uid))).data().displayName, 'Ada');
  await denied(fs.deleteDoc(fs.doc(eve.db, 'profiles', ada.user.uid)));
  await fs.deleteDoc(ref);
  await signOut(ada.auth);
});
