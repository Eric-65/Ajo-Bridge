# Community sign-in and invite links: setup

The **Community** page (`/community`) lets people sign in with Google or with an email and password, get a personal invite link (`/r/<code>`), see how many people joined through it, and choose whether their name and photo appear on the community wall. It runs on Firebase Authentication and Cloud Firestore (free Spark plan is enough). Until the four `VITE_FIREBASE_*` variables are set, the page says "being set up" and the rest of the app works as before.

## What is stored, and who can see it

Emails and passwords are held by Firebase Authentication only. Firestore never stores an email.

| Collection | Contents | Who can read it |
| --- | --- | --- |
| `users/{uid}` | invite code, the code you signed up with, the show-profile switch | only you |
| `refCodes/{code}` | which account owns an invite code | anyone, one code at a time (cannot be listed) |
| `members/{uid}` | the time you joined | anyone (this is how the "N people have joined" count works; it reveals no name) |
| `profiles/{uid}` | display name, photo URL, join date | anyone, and **only while you switch on "Show me in the community"**. Switching off deletes it |
| `referrals/{uid}` | who invited you, and when | only the person who invited you |

The rules in [`firestore.rules`](../firestore.rules) also make referral counts hard to fake: a referral can only be written in the same atomic batch that creates the new member, the inviter must already be a member, you cannot invite yourself, and your invite code and inviter cannot be changed later. `npm run test:community` checks all of this against the Firebase emulators with real signed-in users (it also runs in CI).

## One-time setup (about 10 minutes)

1. Go to https://console.firebase.google.com, **Add project** (Google Analytics is not needed).
2. **Build → Authentication → Get started.** Under **Sign-in method** enable **Google** (pick a support email) and **Email/Password**.
3. **Authentication → Settings → Authorized domains:** add `ajo-bridge.vercel.app` (and any custom domain). `localhost` is there by default.
4. **Build → Firestore Database → Create database**, production mode, any region close to your users.
5. **Firestore → Rules:** replace the contents with [`firestore.rules`](../firestore.rules) and press **Publish**. (Or, with the Firebase CLI: `npx firebase-tools deploy --only firestore:rules --project <project-id>`.)
6. **Project settings (gear) → General → Your apps → Web app (`</>`):** register an app (no hosting). Copy `apiKey`, `authDomain`, `projectId` and `appId` from the config it shows.
7. In **Vercel → the project → Settings → Environment Variables**, add them for Production (and Preview if you like):

   | Name | Value |
   | --- | --- |
   | `VITE_FIREBASE_API_KEY` | `apiKey` |
   | `VITE_FIREBASE_AUTH_DOMAIN` | `authDomain` (`<project-id>.firebaseapp.com`) |
   | `VITE_FIREBASE_PROJECT_ID` | `projectId` |
   | `VITE_FIREBASE_APP_ID` | `appId` |

8. **Deployments → … → Redeploy.** `VITE_` variables are baked in at build time, so a redeploy is required.

The Firebase web config is not a secret: it is shipped to every browser by design, and access is controlled by the security rules and the authorized-domains list. It still belongs in Vercel's environment variables, not in the repository, so forks do not write to your project.

## Check it works

1. Open https://ajo-bridge.vercel.app/community. You see the **Join the community** button instead of "being set up".
2. Sign in with Google. You land back on Community with **You invited 0** and your invite link.
3. Open the invite link in a private window. The sign-in page says **You were invited**. Create an account with email.
4. Back in the first window, reload Community: **You invited 1**. The header count went up by one.
5. In either account switch on **Show me in the community**: the name (and Google photo) appears on the wall. Switch it off and it disappears.

## Run it locally without a Firebase project

Requires Java 11+ for the emulators.

```bash
npx firebase-tools emulators:start --only auth,firestore --project demo-ajo
# in another terminal
cd web && VITE_FIREBASE_EMULATOR=1 npm run dev
```

The emulator's Google button opens a fake account picker; email sign-up works as normal. Data is in memory and is lost when the emulators stop.

## Limits

- Counts are as honest as sign-ups: one person can create several accounts with different emails. Email verification and App Check are not enabled in this version.
- The wall shows the 60 newest public profiles. The total count has no limit.
- Google profile photos are loaded from Google's servers when the wall is viewed.
