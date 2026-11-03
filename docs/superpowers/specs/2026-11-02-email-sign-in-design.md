# Email + password sign-in — design

Date: 2026-11-02. Project 2 of 3 (after account linking, before Google sign-in). Builds on
`2026-11-02-account-linking-design.md`: email becomes one more sign-in method on a Duel
Binder account.

## Why

Android users who don't have Discord can't get an account: Apple sign-in only exists in
the iPhone app. They sign up in the Android app with an email and a password. Once email
exists everywhere, the same person can sign in on the web portal or the desktop app and see
their collection.

## Goals

- Sign up and sign in with an email and password in the Android app, the iPhone app, the
  web portal (including the /scan/ web app) and the desktop app.
- Every email is confirmed with a 6-digit code before anyone relies on it.
- "Forgot password?" emails a code that lets them set a new password.
- Email is a sign-in method like Discord and Apple: it can be added to an existing account
  in Settings → Sign-in methods, and removed if it isn't the last one.
- When an email matches an account that already uses that address, offer to link them
  instead of making a second account.

## Non-goals

- Google sign-in (project 3).
- Magic links or passwordless codes for every sign-in. A code is only sent to confirm an
  address or reset a password.
- Marketing or notification email. The app only sends codes.
- Two-factor authentication.

## Anti-goals

- An account takeover through email: knowing someone's address must never get you into
  their account, and email matching must never merge accounts on its own.
- A sign-up so slow that people give up before their first scan.

## Decisions the owner made

- **One email box** handles both sign-in and sign-up (accepted: anyone can learn whether an
  email has a Duel Binder account).
- **A 6-digit code at sign-up**: the account isn't usable until the code is entered.
- **Reset by emailed code.**
- **Email sent through Cloudflare** (Cloudflare Email Service from the portal Worker). The
  account is on the Workers Paid plan ($5/month), which Email Sending needs; 3,000 emails a
  month are included, then $0.35 per 1,000. Email Sending is a public beta (accepted).
- **Everywhere**: Android, iPhone, web portal, desktop.
- **Matching emails offer to link**, and **signed-in users can add an email** in Settings.

## The flow

Mocked up 2026-11-02 and approved:

1. **Sign-in screen.** A **Continue with email** button below **Sign in with Discord**. On
   the iPhone, Sign in with Apple stays on top (Apple requires it to be offered).
2. **Continue with email.** One email box. "We'll sign you in, or make a new account if
   this email is new."
   - Known email → **Password** screen, with **Forgot password?**.
   - New email → **Create a password**.
3. **Create a password.** For <email>. At least 8 characters (my call; no other rules,
   maximum 128 characters). Button: **Create account**.
4. **Check your email.** "We sent a 6-digit code to <email>. It expires in 15 minutes."
   Six boxes (paste and the phone's one-time-code autofill should fill them), **Confirm**,
   **Send a new code**, **Back**.
5. New accounts then get the username prompt account linking already has.

**Forgot password?** → the same code screen → **Set a new password** → signed in. Setting
a new password signs out the account's other sessions (my call: a reset usually means the
old password may be known to someone else).

Wrong password: "That password doesn't match." with **Forgot password?** beside it.

The web portal shows the same steps as web pages; the desktop app shows them in its own
sign-in screen (no browser trip, unlike Discord).

## Rules (my calls unless noted)

- **Normalising emails:** trim and lowercase; no other rewriting (no Gmail dot or `+`
  stripping). Validate loosely (something@something.something, at most 254 characters).
- **One email per account** and one account per email, like the other providers.
- **The account doesn't exist until the code is confirmed.** Before that, a pending
  sign-up holds the email, the password hash and the code; a new attempt with the same
  email replaces it. Pending sign-ups expire after 24 hours.
- **Codes:** 6 digits from a secure random source, stored hashed, valid 15 minutes,
  single use. 5 wrong tries kill the code (they ask for a new one).
- **Sending limits:** at most one code per email per minute and 5 per email per hour, plus
  a per-address (IP) cap like the other anonymous routes. Over the limit: "Too many codes.
  Try again in a few minutes."
- **Sign-in limits:** wrong passwords are capped per email and per IP (builder picks the
  numbers, e.g. 10 per email per 15 minutes); over the cap, ask them to wait or reset.
- **Passwords** are hashed with PBKDF2-SHA256 through Web Crypto (Workers cap iterations
  at 100,000; use the cap), with a random salt per password and the parameters stored
  with the hash so they can be raised later. Never logged.
- **Admin** stays tied to the Discord sign-in, as before.
- **Deleting an account** deletes its email, password hash and any pending codes.

## Sending email

- Cloudflare Email Service's Workers binding, from `Duel Binder <no-reply@duelbinder.com>`
  (address my call).
- Plain, short messages: subject "Your Duel Binder code: 123456"; body says what the code
  is for (confirming the address, or resetting the password), that it expires in 15
  minutes, and to ignore the email if they didn't ask for it. Text and simple HTML.
- **Owner action:** onboard duelbinder.com for sending in the Cloudflare dashboard (adds the
  SPF/DKIM records) before the deploy. Until then the Worker can't send codes, so the
  email button should stay hidden behind a setting the builder adds (on once sending
  works).
- Send failures show "We couldn't send the code. Try again." and are reported to the
  admin error log.

## Emails from Discord and Apple

- Discord sign-in asks for the `email` scope as well as `identify`. Store the email only
  when Discord says it's verified. Existing users' emails fill in on their next sign-in;
  there is no backfill.
- Sign in with Apple asks for email too. Store it unless Apple marks it as a private relay
  address (my call: relay addresses never match anything). Apple only sends it on the
  first authorisation, so most existing Apple users won't have one.
- These are stored on the sign-in method, not as an email sign-in: they're only used for
  matching. Showing them anywhere is out of scope.
- Update the privacy page: we now store email addresses, used to sign in, send codes and
  offer linking; nothing else.

## Matching emails

Matching only ever **offers**; it never merges by itself. Proof comes from signing in
with the account being linked to.

- **Signing up with an email a Discord or Apple account already uses** (verified, open
  account): after the code is confirmed, before the new account is made:
  "There's already a Duel Binder account using this email. It signs in with Discord.
  Link your email to it?" → **Sign in with Discord to link** / **Make a separate account**.
  - Signing in with that provider proves it's theirs; the email method is attached to that
    account and they're signed in to it. No merge is needed: the new account was never
    made.
  - If the provider sign-in comes back as a different account, say so and go back to the
    choice.
  - Apple-only matches can only be confirmed in the iPhone app; elsewhere offer only
    **Make a separate account**, with a line saying they can link later from the iPhone.
- **Signing in with Discord or Apple for the first time** (no account yet) when the
  provider's verified email matches an account's email sign-in: offer "There's already a
  Duel Binder account using this email. Link Discord to it?" → enter that account's
  password (or Forgot password?) to link, or **Make a separate account**.
- **Adding an email in Settings** that another account already uses as its email sign-in:
  this is the existing link-to-another-account case. Their password proves it, then the
  account linking merge screen runs as it does today.
- Adding an email in Settings that only matches another account's Discord or Apple email
  (not an email sign-in): attach it; no offer (my call: they're already signed in, and the
  other account is reachable through its own provider).

## Settings → Sign-in methods

- **Email** appears in the list with the address. **Add email**: email → password → code →
  attached. **Remove** like the others (not when it's the last method).
- With email attached: **Change password** (current password, then new) and **Change
  email** (current password, new email, code sent to the new address; the old address gets
  a short "your sign-in email was changed" notice). Without Change email, an Android user
  whose only sign-in is email could never move to a new address. (My call.)

## Platforms

- Android and iPhone apps: native screens as mocked up; they get a token the way Apple
  sign-in does today.
- Web portal and /scan/: the same steps as pages; a session cookie as with Discord.
- Desktop app: the steps in its sign-in screen; it gets the same kind of token its browser
  sign-in ends with. Older app versions keep working with Discord only.

## What's left to the builder

- Route names, the table layout for email sign-ins, pending sign-ups and codes, and the
  schema version bump.
- Exact rate-limit numbers within the rules above.
- How the desktop and phone apps call the email routes (JSON, same-origin rules as
  `/auth/phone/token`).
- The feature setting that hides the email button until sending works.
- Tests: the Worker's code/password/limit logic and each matching path; client screens.

## Settled after the builder check (my calls)

- **Holding state between steps.** A confirmed-code-but-no-account-yet state and an
  unlinked first-time Discord/Apple sign-in are each held server-side in a short-lived,
  single-use ticket (15 minutes, random, stored hashed), handed to the client like the
  existing merge ticket. The desktop browser hand-off and the phone token paths carry the
  ticket the same way they carry link codes today.
- **Closed and deleted accounts.** Deleting an account removes its email sign-in at once,
  so the address is free to sign up again. During a merge's 30-day hold the email sign-in
  has already moved to the surviving account (as all sign-ins do), so nothing collides.
  Undoing a merge moves it back; if the address was since used elsewhere, undo reports it
  and leaves the email off the restored account.
- **Merges where both accounts have an email.** Add email only offers to link another
  account when this account has no email; if the two accounts would end up with two
  emails (or two of any provider), refuse with "That account also has <provider>. Sign in
  to it and remove one first." The existing one-per-provider rule stands.
- **Password as proof.** Entering the other account's password is a new proof type in the
  link flow, producing the same link ticket the merge screen consumes; it shares the
  wrong-password limits.
- **Change email to a taken address.** Refused: "That email is already used by another
  account." Matching another account's Discord/Apple email is fine. The old address keeps
  working until the new one's code is confirmed.
- **"Other sessions"** means every session row for the account except the one making the
  change (web cookies, desktop and phone tokens), plus any open link or merge tickets.
- **Rate-limit counters** live in the Durable Object's SQLite, cleaned by the existing
  sweep.
- **Stale provider emails.** Each Discord/Apple sign-in replaces the stored email with what
  the provider sends now; an unverified or missing email clears it.
- **Email-only accounts** are full accounts: friends, binders, avatars (a placeholder),
  usage and the admin lists treat them like Apple-only accounts.
- **Sending in tests and development** goes through a fake sender that records messages;
  the real binding is only used in the deployed Worker.
