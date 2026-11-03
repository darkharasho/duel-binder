# Email + password sign-in Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** People can sign up and sign in with an email and a password on Android, iPhone, the web portal, /scan/ and desktop. They confirm the address with a 6-digit code and reset by code. Email becomes a sign-in method in Settings, and a matching email offers to link instead of making a second account.

**Architecture:** Email is a `sign_ins` row with `provider = 'email'` and `subject` = the normalized address. Its password hash lives on that row (new `password_hash` column), so merges, undo and deletion move or drop it with the sign-in. Discord and Apple sign-ins store the provider's verified email in a new `sign_ins.email` column, used only for matching. One server core (`emailAuth.ts`) runs every step. Two adapters sit on top of it: JSON routes `POST /auth/email/<step>` for the apps (phone and desktop get a desktop-kind token), and server-rendered HTML forms for browsers (web portal and /scan/ in a browser get the web session cookie). Codes go out through an `EmailSender` dependency. It is Cloudflare's `send_email` binding in the deployed Worker and a fake in tests. The `EMAIL_SIGN_IN` var hides everything until the owner turns it on.

**Tech Stack:** Cloudflare Worker + Durable Object SQLite (`workers/portal`), Web Crypto PBKDF2, better-sqlite3 + vitest (`tests/portal`, `tests/renderer`, `tests/main`), Electron main (`src/main/cloud`), the shared React renderer (`src/renderer`), the phone app (`src/phone`), Capacitor iOS (`ios/App/App/WebAuthPlugin.swift`).

**Spec:** `docs/superpowers/specs/2026-11-02-email-sign-in-design.md`

## Global Constraints

- Emails: trim and lowercase, no other rewriting. Valid when they match `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` and are at most 254 characters.
- Passwords: 8 to 128 characters, no other rules. PBKDF2-SHA256 at 100,000 iterations (the Workers cap), a 16-byte random salt, stored as `pbkdf2-sha256$100000$<salt b64url>$<hash b64url>`. Never logged and never returned.
- Codes: 6 digits from `crypto.getRandomValues`, stored as `sha256Hex(ticketHash + ':' + code)`, valid 15 minutes, single use. 5 wrong tries kill the code. A new code replaces the old one.
- Pending sign-ups expire after 24 hours. Server tickets (confirmed code with no account yet, provider claims) expire after 15 minutes. All are random, single use and stored hashed.
- Sending limits: 1 code per email per minute, 5 per email per hour, 20 per IP per hour. Over the limit, show exactly: "Too many codes. Try again in a few minutes."
- Wrong-password limits: 10 per email per 15 minutes, 50 per IP per 15 minutes. Only wrong passwords count. Over the limit, show exactly: "Too many tries. Wait a few minutes or reset your password."
- Copy, verbatim: "That password doesn't match." · "We couldn't send the code. Try again." · "That email is already used by another account." · "That code doesn't match." · "That code has expired. Send a new one." · "We'll sign you in, or make a new account if this email is new." · "There's already a Duel Binder account using this email. It signs in with <Provider>. Link your email to it?" · "There's already a Duel Binder account using this email. Link <Provider> to it?" · "That account also has <provider>. Sign in to it and remove one first."
- Mail: from `Duel Binder <no-reply@duelbinder.com>`, subject `Your Duel Binder code: 123456`, both text and simple HTML.
- Matching only offers. Nothing merges on email alone. Proof is the matched account's own sign-in: Discord or Apple, or its password.
- At most one sign-in per provider per account, and one account per email.
- Admin stays tied to the Discord sign-in.
- Old clients keep working. New request fields are opt-in, and new `Me` fields are optional.
- DO SQLite: one query per table, no compound queries of about 10 terms.
- Tests: `npm test -- <paths>` (vitest, `--maxWorkers=2` already set). Never build 100k+ row test data. Tests use the fake sender, never the binding.
- This plan never deploys the Worker or publishes a release.

## Rulings made while planning (from reading the code)

- **The password hash lives on the `sign_ins` row.** Merges move `sign_ins` rows wholesale (`merge.ts` `moveSignIns`), undo moves them back, and account deletion cascades. Keeping the hash on the row gets all three right with no new code. Cost if wrong: a later table split.
- **Browsers get HTML forms, apps get a React flow.** The signed-out web portal is server-rendered HTML (`home.ts`), and /scan/ in a browser already signs in through the cookie and `exchangeCookie`. So the browser flow is plain forms with no JavaScript (it fits the CSP) that end in the session cookie. iOS, Android and desktop share one React component that talks to the JSON routes. Cost if wrong: the copy is written twice. Every string comes from one shared module.
- **The provider claim is opt-in.** The case of a first Discord/Apple sign-in whose email matches an email account only triggers for clients that ask (`offer=email` on `/auth/desktop/start`, `offerLink: true` on `/auth/apple/token`). Web Discord sign-in always asks. Old desktop and phone builds get a plain new account, as today.
- **Merging after Add email happens only on the phone.** `account:merge` is phone-only today (`ipc.ts`). On desktop and web, Add email matching another account's email sign-in answers "That email belongs to another account. Link it from the Duel Binder phone app." Cost if wrong: building the merge screen on desktop and web later.
- **Change password also signs out other sessions**, the same as a reset. To keep the caller's own session, `SessionUser` gains `tokenHash`, and `RpcDeps` gains `sessionHash`.
- **Forgot password for an unknown email** answers "No account uses this email." The single email box already reveals whether an account exists, and the owner accepted that.
- **A matched account that already has an email sign-in is skipped** for the sign-up offer. It can't take a second email.
- **Change email notice:** to the old address, subject "Your Duel Binder sign-in email was changed". The body names the new address and says: "If you didn't make this change, email support@duelbinder.com." That is the contact on the privacy page.

## Review Focus

1. **The same address typed with capitals or spaces on another device** should reach the same account. Task 2: `signs in with a differently-cased email`.
2. **Two sign-ups for one email confirmed in turn** (two phones, or someone else signed up first). The second confirm must fail with "That email is already used by another account." It must not make two accounts. Task 2: `a second pending sign-up for a taken email can't confirm`.
3. **An old code entered after Send a new code** must be refused. Only the newest code works. Task 2: `resend replaces the code`.
4. **A reset while other devices are signed in.** Their tokens stop working (401) and they sign out the way they already do. The resetting device stays signed in. Task 2: `reset signs out every other session`. Task 6: `changePassword keeps the caller's session`.
5. **An email account merged into a Discord account, then undone by the admin.** The email sign-in and its password go back to the restored account. Task 6: `merge undo moves the email sign-in and its password back`.
6. **An old phone or desktop build signing in with Discord for the first time, when an email account has that address.** It gets a new account with no claim, as today. Task 5: `no offer without offer=email`.

---

### Task 1: Schema, email rules, passwords, codes, limits and the sender

**Files:**
- Modify: `workers/portal/src/migrate.ts` (append `server-34`)
- Create: `src/shared/emailAuth.ts`
- Create: `workers/portal/src/password.ts`
- Create: `workers/portal/src/authLimits.ts`
- Create: `workers/portal/src/emailSend.ts`
- Modify: `workers/portal/src/app.ts` (`Env.EMAIL_SIGN_IN?: string`, `AppDeps.email?: EmailSender`)
- Modify: `workers/portal/src/auth.ts` (`pruneExpired` also clears `email_flows`, `provider_claims` and `auth_limits` older than an hour)
- Modify: `workers/portal/src/errors.ts` (add `logServerError`)
- Modify: `tests/portal/helpers.ts` (add `fakeSender()`)
- Test: `tests/portal/migrate.test.ts`, `tests/portal/password.test.ts`, `tests/portal/auth-limits.test.ts`, `tests/shared/emailAuth.test.ts`

**Interfaces:**
- Produces, in `src/shared/emailAuth.ts`:
  - `MAX_EMAIL_LEN = 254`, `MIN_PASSWORD = 8`, `MAX_PASSWORD = 128`, `CODE_LENGTH = 6`
  - `normalizeEmail(raw: string): string`
  - `emailProblem(email: string): string | null`, which returns `'Enter a valid email address'`
  - `passwordProblem(pw: string): string | null`, which returns `'Passwords are at least 8 characters'` or `'Passwords are at most 128 characters'`
  - `EMAIL_COPY`: one object holding every verbatim string from Global Constraints. Keys: `wrongPassword`, `tooManyCodes`, `tooManyTries`, `sendFailed`, `emailTaken`, `codeWrong`, `codeExpired`, `noAccount`, `oneBox`, `matchProvider(p)`, `matchClaim(p)`, `alsoHas(p)`, `mergeOnPhone`, `otherAccount` ("That <Provider> account isn't the one using this email.")
  - `type EmailStep = 'check' | 'password' | 'create' | 'confirm' | 'resend' | 'forgot' | 'reset' | 'separate' | 'link-discord' | 'link-apple' | 'claim' | 'claim-separate'`
  - `type EmailAuthReply`:
    - `{ next: 'password' | 'create'; email: string }`
    - `{ next: 'code'; ticket: string; email: string; purpose: 'signup' | 'reset' }`
    - `{ next: 'new-password'; ticket: string }`
    - `{ next: 'match'; ticket: string; email: string; providers: SignInProvider[] }`
    - `{ next: 'signed-in'; token: string; user: Me; created: boolean }`
  - `type EmailAuthView`: the same union, except `signed-in` has no `token` (what renderers see).
- Produces, in `password.ts`: `hashPassword(pw: string): Promise<string>`, `verifyPassword(pw: string, stored: string): Promise<boolean>`. It reads iterations from the stored string, and an unknown format answers false.
- Produces, in `authLimits.ts`:
  - `type LimitKind = 'code-email-min' | 'code-email-hour' | 'code-ip' | 'password-email' | 'password-ip' | 'check-ip'`
  - `LIMITS: Record<LimitKind, { max: number; windowMs: number }>`: 1/60s, 5/1h, 20/1h, 10/15m, 50/15m, 100/1h
  - `isLimited(db, kind, key, now): boolean`
  - `recordAttempt(db, kind, key, now): void`
  - `takeLimit(db, kind, key, now): boolean`, which checks, then records when under
  - `clientIp(req: Request): string`, which reads `cf-connecting-ip` trimmed and lowercased, else `'unknown'`
- Produces, in `emailSend.ts`:
  - `interface EmailMessage { to: string; subject: string; text: string; html: string }`
  - `interface EmailSender { send(m: EmailMessage): Promise<void> }`
  - `codeMessage(to, code, purpose: 'signup' | 'reset' | 'add' | 'change'): EmailMessage`
  - `changedNotice(to, newEmail): EmailMessage`
  - `bindingSender(binding: SendEmail): EmailSender`, which sends from `{ email: 'no-reply@duelbinder.com', name: 'Duel Binder' }`
  - `emailEnabled(deps: AppDeps): boolean`, which is `env.EMAIL_SIGN_IN === 'on' && deps.email !== undefined`
- Produces, in `errors.ts`: `logServerError(deps: AppDeps, message: string): void`. It writes an `error_reports` row with platform `'server'` and app version `'worker'`.
- Produces, in `helpers.ts`: `fakeSender(): EmailSender & { sent: EmailMessage[]; failNext(): void; lastCode(): string }`

- [ ] **Step 1: Write the failing tests**
  - `migrate.test.ts` `server-34 adds email columns and tables`. After migrating:
    - `sign_ins` has `email` and `password_hash`.
    - `email_flows`, `provider_claims` and `auth_limits` exist.
    - A pre-existing sign-in keeps both new columns null.
  - `password.test.ts`:
    - `hashes verify and differ per salt`: two hashes of `hunter2hunter2` differ, and both verify.
    - `a wrong password fails`.
    - `the stored format names its iterations`: matches `/^pbkdf2-sha256\$100000\$[\w-]+\$[\w-]+$/`.
    - `a malformed stored hash verifies false`.
  - `auth-limits.test.ts`:
    - `code-email-min allows one a minute`: the second take within 60s is false, and it is true again after 61s.
    - `windows are per key`.
    - `isLimited doesn't record`.
  - `emailAuth.test.ts` (shared):
    - `normalizeEmail(' Ann@Example.COM ')` is `'ann@example.com'`, and `'a.b+c@x.io'` stays as it is.
    - `emailProblem` rejects `'a@b'`, `'a b@c.d'` and a 255-character address.
    - `passwordProblem` limits are 7 → too short, 8 → ok, 128 → ok, 129 → too long.
- [ ] **Step 2: Run them to verify they fail**
  Run: `npm test -- tests/portal/migrate.test.ts tests/portal/password.test.ts tests/portal/auth-limits.test.ts tests/shared/emailAuth.test.ts`
  Expected: FAIL. The modules are missing and `server-34` doesn't exist.
- [ ] **Step 3: Add migration `server-34`**

```sql
ALTER TABLE sign_ins ADD COLUMN email TEXT;
ALTER TABLE sign_ins ADD COLUMN password_hash TEXT;
CREATE INDEX ix_sign_ins_email ON sign_ins(email);
CREATE TABLE email_flows (ticket_hash TEXT PRIMARY KEY,
  purpose TEXT NOT NULL CHECK (purpose IN ('signup','reset','add','change')),
  email TEXT NOT NULL, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  password_hash TEXT, code_hash TEXT, code_expires_at TEXT, tries INTEGER NOT NULL DEFAULT 0,
  confirmed INTEGER NOT NULL DEFAULT 0, expires_at TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX ix_email_flows_email ON email_flows(email);
CREATE TABLE provider_claims (ticket_hash TEXT PRIMARY KEY, provider TEXT NOT NULL,
  subject TEXT NOT NULL, profile TEXT NOT NULL, email TEXT NOT NULL, apple_refresh_token TEXT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  challenge TEXT, kind TEXT NOT NULL CHECK (kind IN ('web','desktop')), expires_at TEXT NOT NULL);
CREATE TABLE auth_limits (kind TEXT NOT NULL, key TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX ix_auth_limits ON auth_limits(kind, key, created_at);
```

  - `sign_ins.email` is the provider's verified email, for discord/apple rows. It is null on email rows, whose subject is the address.
  - `email_flows.user_id` is set for the `add` and `change` purposes.
  - `provider_claims.user_id` is the email account being claimed.
  - `provider_claims.challenge` is null for Apple claims, which are answered directly to the app.
- [ ] **Step 4: Implement the modules above, `fakeSender`, and the `pruneExpired` additions**
- [ ] **Step 5: Run the tests to verify they pass**, plus `tests/portal/auth.test.ts` (prune still works). Expected: PASS.
- [ ] **Step 6: Commit** `feat(portal): email sign-in schema, passwords, limits, sender`

### Task 2: Sign up, sign in and reset (core + JSON routes)

**Files:**
- Create: `workers/portal/src/emailAuth.ts`
- Modify: `workers/portal/src/app.ts` (routes `POST /auth/email/:step`, `GET /auth/email/status`)
- Modify: `workers/portal/src/appCors.ts` (`BEARER_ROUTES` += `/^\/auth\/email\/[a-z-]+$/`)
- Modify: `workers/portal/src/auth.ts`:
  - `SessionUser` gains `tokenHash`.
  - Export `mintSession(deps, userId, kind, nowIso): Promise<string>`, factored out of the existing inserts.
  - `loadMe` sets `emailSignIn: true` when `emailEnabled`.
- Modify: `src/shared/cloud.ts` (`Me.emailSignIn?: boolean`)
- Modify: `src/shared/account.ts` (`SignInProvider` += `'email'`; `SignInMethod.email?: string`)
- Test: `tests/portal/email-auth.test.ts` (new)

**Interfaces:**
- Consumes: Task 1, plus `createAccount` and `findAccount` from `signIns.ts`.
- Produces, in `emailAuth.ts`:
  - `type StepOutcome`: an `EmailAuthReply` without its `signed-in` variant, or `{ next: 'signed-in'; userId: number; created: boolean }`. The adapters mint the session.
  - `class EmailAuthError extends Error { status: 400 | 404 | 429 }`. The message is user copy from `EMAIL_COPY`.
  - `runEmailStep(deps: AppDeps, step: EmailStep, body: Record<string, unknown>, ctx: { ip: string; keepSession?: string }): Promise<StepOutcome>`. Tasks 4 and 5 add their steps to it.
  - `emailAuthRoute(req, deps, step): Promise<Response>`. It answers JSON, requires JSON content type, and turns `signed-in` into a desktop-kind token (`{ next, token, user, created }`). When email is off, it answers 404 `{ error: 'email-off' }`.
  - `revokeOtherSessions(db, userId, keepTokenHash: string | null): void`. It deletes the account's sessions except `keepTokenHash`, and its `merge_tickets`, `email_flows` and `provider_claims`.
  - `attachEmail(db, userId, email, passwordHash, nowIso): void`. It inserts the email sign-in and calls `refreshLegacyDiscordId`. It throws `EmailAuthError(emailTaken)` when the subject is already in `sign_ins`.
  - `sendCode(deps, flow: { ticketHash; email; purpose }, ip, now): Promise<void>`. It applies the three code limits, writes a fresh `code_hash` with `code_expires_at` 15 minutes ahead and resets `tries` to 0, then sends. A send failure calls `logServerError` and throws `sendFailed`.
- Step behaviour. `email` is always normalized first. `check` is limited by `check-ip`.
  - `check {email}` → `password` if an email sign-in has that subject, else `create`.
  - `password {email, password}`:
    - Over a limit → 429 `tooManyTries`.
    - Wrong password → record against both limits → 400 `wrongPassword`.
    - Right → `signed-in` with `created: false`.
  - `create {email, password}`:
    - `emailProblem` or `passwordProblem` → 400.
    - Taken → `emailTaken`.
    - Otherwise: delete any `signup` flow for this email, insert one that expires in 24 hours and stores `hashPassword(password)`, call `sendCode`, and reply `code` with purpose `signup`.
  - `confirm {ticket, code}`:
    - Unknown or expired flow → `codeExpired`.
    - Code past `code_expires_at` → `codeExpired`.
    - Wrong code → `tries + 1`; at 5, null the code → `codeExpired`. Otherwise `codeWrong`.
    - Right, purpose `signup` → `createAccount(db, {provider:'email', subject: email}, {displayName: null, avatar: null}, nowIso)`. It sets the password hash and deletes the flow → `signed-in` with `created: true`. If the email was taken meanwhile → `emailTaken`. (Task 4 inserts the match branch before account creation.)
    - Right, purpose `reset` → set `confirmed = 1` and `expires_at` = now + 15 minutes → `new-password`.
  - `resend {ticket}` → `sendCode` on the same flow → `code`. Codes are only checked against the newest `code_hash`.
  - `forgot {email}` → no email sign-in → 404 `noAccount`. Otherwise replace the `reset` flow, `sendCode`, and reply `code` with purpose `reset`.
  - `reset {ticket, password}`:
    - The flow must be confirmed and the password must pass `passwordProblem`.
    - Then set the hash, call `revokeOtherSessions(db, userId, null)` and delete the flow → `signed-in`.
- `GET /auth/email/status` → `{ enabled: emailEnabled(deps) }`, with no session needed.

- [ ] **Step 1: Write the failing tests** in `email-auth.test.ts`. Use the `link.test.ts` deps pattern with `email: fakeSender()` and `EMAIL_SIGN_IN: 'on'`. Drive everything through `handle()`.
  - `status reports enabled only with the var and a sender`.
  - `routes answer 404 email-off when disabled`.
  - `a new email goes to create, then a code, then a signed-in new account`:
    - The sent message's subject is `Your Duel Binder code: <code>` and its `to` is the normalized email.
    - `/api/me` with the token shows `usernameChosen: false`.
    - `account:signIns` lists `{provider:'email', email}`.
  - `signs in with a differently-cased email`: create `ann@x.io`, then `password {email:' ANN@x.io '}` → signed-in as the same user id.
  - `a wrong password answers the copy and counts`: the 11th wrong try in 15 minutes → 429 `tooManyTries`, even with the right password.
  - `the account doesn't exist before the code`: after `create`, `check` still answers `create`, and the users count is unchanged.
  - `a wrong code five times kills it`: the 5th try answers `codeExpired`, and the right code then fails too.
  - `a code past 15 minutes is refused`.
  - `resend replaces the code`: the first code is refused after a resend, and the second works.
  - `a second code within a minute is refused`: resend straight away → 429 `tooManyCodes`. 6 sends in an hour (advancing 61s each) → the 6th is refused.
  - `a send failure answers sendFailed and logs`: `failNext()` → 400 `sendFailed`, and one `error_reports` row with platform `server`.
  - `a newer sign-up replaces the older one`: two `create`s for the same email. The first flow's ticket and code are now refused (`codeExpired`), and the second works.
  - `a second pending sign-up for a taken email can't confirm`: insert the address's email sign-in directly after `create`, then confirm → `emailTaken`, and the users count is unchanged.
  - `forgot → code → new password signs in and reset signs out every other session`:
    - Before: two tokens for the account.
    - After: both get 401 on `/api/me`, and the new token works.
    - The old password fails and the new one works.
  - `forgot for an unknown email answers noAccount`.
  - `pending sign-ups expire after 24 hours`: confirm at +24h+1s → `codeExpired`.
  - `the password is never in a response or the sent mail`: across the happy path, scan every response body and message for the password string.
- [ ] **Step 2: Run them to verify they fail**
  Run: `npm test -- tests/portal/email-auth.test.ts`
  Expected: FAIL, 404 on every `/auth/email/*` route.
- [ ] **Step 3: Implement `emailAuth.ts`, the routes, `mintSession`, `SessionUser.tokenHash`, `Me.emailSignIn` and the CORS route.** Each step's reads and writes run in one `db.transaction`. Async work (hashing, sending) happens before or after it, as `beginLink` does.
- [ ] **Step 4: Run the tests to verify they pass**, plus `tests/portal/auth.test.ts tests/portal/app-cors.test.ts tests/portal/sign-ins.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(portal): email sign-up, sign-in and reset`

### Task 3: Emails from Discord and Apple

**Files:**
- Modify: `workers/portal/src/auth.ts`:
  - `discordAuthorize` uses scope `'identify email'`.
  - `DiscordUser` gains `email?`, `verified?`.
  - `discordSignIn` passes the email.
  - The link-code `profile` JSON carries `email`.
- Modify: `workers/portal/src/signIns.ts`:
  - `SignInProfile.email?: string | null`.
  - `signInWith` and `createAccount` write `sign_ins.email` on every sign-in. Null clears it.
- Modify: `workers/portal/src/apple.ts`. `verifyAppleIdentityToken` returns `{ sub, email: string | null }`, where `email` is null unless `email_verified` is true and `is_private_email` isn't. Update its callers (`verifyAppleSignIn` returns `email` too).
- Modify: `workers/portal/src/link.ts` (`beginLink` stores the linked sign-in's email)
- Modify: `ios/App/App/WebAuthPlugin.swift:81` → `[.fullName, .email]`
- Modify: `workers/portal/src/site/privacy.ts`. Replace the `identify`-scope sentence: we now also ask Discord and Apple for your email, and keep it, and any email you sign up with, only to sign you in, send codes and offer linking. Nothing else.
- Test: `tests/portal/auth.test.ts`, `tests/portal/apple-auth.test.ts`, `tests/portal/link.test.ts`, `tests/portal/site-page.test.ts`

- [ ] **Step 1: Write the failing tests**
  - `auth.test.ts` line 91: the scope is `'identify email'`.
  - `stores Discord's email only when verified`: `{email:'Ann@X.io', verified:true}` → `sign_ins.email = 'ann@x.io'`. A second sign-in with `verified:false` → null.
  - `apple-auth.test.ts` `keeps a verified Apple email but not a private relay`:
    - `{email, email_verified:true}` → stored, normalized.
    - `is_private_email: true` → null.
    - `email_verified` given as the string `"true"` counts as true.
  - `link.test.ts` `a linked Discord brings its verified email`.
  - `site-page.test.ts`: update the scope sentence assertion to the new wording.
- [ ] **Step 2: Run them to verify they fail**
  Run: `npm test -- tests/portal/auth.test.ts tests/portal/apple-auth.test.ts tests/portal/link.test.ts tests/portal/site-page.test.ts`
  Expected: FAIL on the scope and the email columns.
- [ ] **Step 3: Implement.** Normalize with `normalizeEmail`, and store null when `emailProblem` objects.
- [ ] **Step 4: Run the tests to verify they pass.** Expected: PASS, with every existing Apple and Discord test unchanged apart from the scope.
- [ ] **Step 5: Commit** `feat(portal): keep verified Discord and Apple emails for matching`

### Task 4: Signing up with an email a Discord or Apple account uses

**Files:**
- Modify: `workers/portal/src/emailAuth.ts` (the match branch in `confirm`; steps `separate`, `link-discord`, `link-apple`; `attachFromFlow`)
- Modify: `workers/portal/src/link.ts` (export `takeLinkCode(deps, code, verifier): Promise<{ subject: string; profile: DiscordProfile } | null>`, factored out of `linkCode`)
- Modify: `workers/portal/src/auth.ts`:
  - `startSignIn` accepts `?link=email` and keeps the `email_link` cookie the HTML flow set.
  - The web branch of `finishSignIn`: with an `email_link` cookie, it calls `attachFromFlow` instead of `discordSignIn`, and redirects to `/auth/email/match?error=other-account` on a mismatch.
- Test: `tests/portal/email-match.test.ts` (new)

**Interfaces:**
- Produces: `attachFromFlow(deps, ticket: string, id: Identity, nowIso): Promise<number>`. The flow must be a confirmed `signup` flow. `findAccount(id)` must be an account whose provider email equals the flow's email. If that account already has an email sign-in → `EmailAuthError(alsoHas('email'))`. On a mismatch → `EmailAuthError(otherAccount)`. Otherwise it attaches the email sign-in with the flow's password hash, deletes the flow, and returns that account's id.
- Branch: on a right `signup` code, look for open accounts whose discord/apple sign-in has `email` = the flow's email and that have no email sign-in. Take the oldest. If one exists → `confirmed = 1`, expires in 15 minutes → `{ next: 'match', ticket, email, providers }`, where `providers` is that account's discord/apple providers.
- Steps:
  - `separate {ticket}` → confirmed signup flow → the same account creation as the no-match path.
  - `link-discord {ticket, code, verifier}` → `takeLinkCode`, then `attachFromFlow` → `signed-in` as that account (`created: false`).
  - `link-apple {ticket, identityToken, nonce}` → `verifyAppleSignIn`, then `attachFromFlow`.

- [ ] **Step 1: Write the failing tests** in `email-match.test.ts`:
  - `a sign-up matching a Discord account's email offers to link`: confirm → `match` with `providers: ['discord']`. The users count is unchanged.
  - `link-discord attaches the email to that account and signs in`: afterwards `account:signIns` lists discord and email, and the email password signs in to the same id.
  - `link-discord with a different Discord account is refused and the choice stays`: `otherAccount`, then `separate` still works.
  - `separate makes a new email account and leaves the Discord one alone`.
  - `an Apple-only match lists only apple`, and `link-apple` attaches it.
  - `an unverified Discord email never matches`: Discord stored a null email → no `match`.
  - `a matched account that already has an email is skipped` → straight to signed-in.
  - `the match ticket dies after 15 minutes` → `codeExpired`.
  - `web: the email_link cookie attaches on the Discord callback`: drive `/auth/discord/start?link=email` with the cookie, then the callback → the session cookie belongs to the Discord account, and the email is attached.
- [ ] **Step 2: Run them to verify they fail**
  Run: `npm test -- tests/portal/email-match.test.ts`
  Expected: FAIL. `confirm` answers `signed-in`.
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run the tests to verify they pass**, plus `tests/portal/link.test.ts tests/portal/email-auth.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(portal): offer to link a sign-up to the account using its email`

### Task 5: A first Discord or Apple sign-in whose email has an email account

**Files:**
- Create: `workers/portal/src/emailClaim.ts`
- Modify: `workers/portal/src/auth.ts`:
  - The `desktop_auth` cookie gains an optional `offer` part, from `?offer=email` on `/auth/desktop/start`. It combines with `link`: parts are `port.state.challenge[.link][.offer]`; link flows ignore offer.
  - `finishSignIn` desktop and web branches: when the Discord user has no account, the offer is on (web always) and `claimTarget` finds one → make a claim instead of an account.
    - Desktop: callback `?claim=<ticket>&email=<email>`.
    - Web: cookie `email_claim`, redirect to `/auth/email/claim`.
  - `exchangeAppleToken`: with body `offerLink: true` and a match → 200 `{ claim, email, provider: 'apple' }`, with no token and no account.
- Modify: `workers/portal/src/emailAuth.ts` (steps `claim`, `claim-separate`)
- Test: `tests/portal/email-claim.test.ts` (new)

**Interfaces:**
- Produces, in `emailClaim.ts`:
  - `claimTarget(db, email: string | null): number | null`: the open account whose email sign-in subject is `email`.
  - `makeClaim(deps, input: { provider; subject; profile: SignInProfile; email; appleRefreshToken; userId; challenge: string | null; kind: 'web' | 'desktop' }): Promise<string>`: a ticket that expires in 15 minutes.
  - `takeClaim(db, ticket, verifier: unknown, kind): ClaimRow | null`. It checks PKCE against `challenge` when that isn't null and requires the matching `kind`. It deletes the row only on success, so a wrong password can retry.
- Steps:
  - `claim {ticket, password, verifier?}`:
    - Password limits keyed by the claimed account's email.
    - Wrong → `wrongPassword`, and the claim stays.
    - Right → the account must not already have this provider (else `alsoHas(provider)`). Insert the provider sign-in with its email, save the Apple refresh token if any, call `refreshLegacyDiscordId`, delete the claim → `signed-in` as the email account.
  - `claim-separate {ticket, verifier?}` → `createAccount` for the provider with the stored profile → `signed-in` with `created: true`.
  - Web forms read the ticket from the `email_claim` cookie, not the body.

- [ ] **Step 1: Write the failing tests** in `email-claim.test.ts`:
  - `desktop Discord sign-in with offer=email and a matching email account hands back a claim`: the callback carries `claim` and `email`, and no account was made.
  - `no offer without offer=email`: the same Discord user without offer → `code=`, and a new account.
  - `claim with the right password links Discord to the email account`: the token's `/api/me` id is the email account's, and a later Discord sign-in reaches it.
  - `claim needs the PKCE verifier`: a wrong verifier → `codeExpired`.
  - `a wrong password keeps the claim; the limit applies`.
  - `claim-separate makes the Discord account`.
  - `Apple offerLink returns a claim without a verifier` and `claim` works with `verifier` omitted.
  - `web: Discord callback with a match sets email_claim and redirects to /auth/email/claim`.
  - `a claim dies after 15 minutes`.
- [ ] **Step 2: Run them to verify they fail**
  Run: `npm test -- tests/portal/email-claim.test.ts`
  Expected: FAIL. The sign-ins make accounts.
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run the tests to verify they pass**, plus `tests/portal/auth.test.ts tests/portal/desktop-auth.test.ts tests/portal/apple-auth.test.ts tests/portal/phone-auth.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(portal): offer to link a first Discord or Apple sign-in to its email account`

### Task 6: Email in Settings (RPCs)

**Files:**
- Create: `workers/portal/src/emailAccount.ts`
- Modify: `workers/portal/src/rpc.ts` (handlers; `RpcDeps.sessionHash`)
- Modify: `workers/portal/src/accountRpc.ts`:
  - `PROVIDERS` += `'email'`.
  - `listSignIns` returns `email` for email rows.
  - `removeSignIn('email')` is allowed.
- Modify: `workers/portal/src/link.ts` (`has-provider` results carry `provider`)
- Modify: `src/shared/account.ts`:
  - `EmailCodeResult = { status: 'code'; ticket: string }`
  - `AddEmailResult = EmailCodeResult | LinkResult`
  - `LinkResult` has-provider gets `provider?: SignInProvider`
- Modify: `src/shared/portal.ts`, `src/shared/ipc.ts` (channel names and `Api.account` methods, below)
- Modify: `workers/portal/src/stats.ts` (`email: withSignIn('email')`)
- Test: `tests/portal/email-account.test.ts` (new), `tests/portal/merge-undo.test.ts`, `tests/portal/account-delete.test.ts`, `tests/portal/admin-stats.test.ts`

**Interfaces:**
- Produces RPC channels, also in `Api.account`:
  - `account:addEmail(email, password) → AddEmailResult`
  - `account:confirmEmail(ticket, code) → { status: 'linked' }`
  - `account:resendEmailCode(ticket) → EmailCodeResult`
  - `account:changePassword(current, next) → void`
  - `account:changeEmail(currentPassword, newEmail) → EmailCodeResult`
  - Every one needs `emailEnabled`, else it throws `'Email sign-in is off'`.
- Behaviour:
  - `addEmail`:
    - This account already has email → `{status:'has-provider', provider:'email'}`.
    - The address is another open account's email sign-in → check `password` against that row's hash (password limits; wrong → `wrongPassword`), then `beginLink(deps, userId, {provider:'email', subject}, {})`. The existing merge, has-provider and daily allowance rules apply.
    - Otherwise → the problem checks, an `add` flow storing the hash, `sendCode`, and `{status:'code', ticket}`.
  - `confirmEmail`: the flow must be this user's.
    - `add` → `attachEmail`.
    - `change` → update the email row's subject to the new address. If it was taken meanwhile → `emailTaken`. Then send `changedNotice` to the old address; a failed notice is only logged.
  - `changePassword`: verify current (limits) → `passwordProblem(next)` → set the hash → `revokeOtherSessions(db, userId, deps.sessionHash)`.
  - `changeEmail`: verify the current password → normalize and check the new address → taken by an email sign-in → `emailTaken` → a `change` flow → `sendCode` → `{status:'code', ticket}`. The old address works until the confirm.

- [ ] **Step 1: Write the failing tests** in `email-account.test.ts`, signed in with Discord:
  - `addEmail sends a code and confirmEmail attaches it`: signing in with that email and password then reaches the same account.
  - `addEmail for another account's email sign-in needs its password and returns a merge`: wrong password → `wrongPassword`. Right password → `status: 'merge'` with a preview.
  - `addEmail when the other account also has Discord answers has-provider with provider discord`.
  - `addEmail matching only another account's Discord email attaches with a code`, with no offer.
  - `addEmail refuses a second email` → `has-provider` with provider `email`.
  - `changePassword keeps the caller's session`: three tokens; after the call only the caller's works, and the old password fails.
  - `changeEmail confirms on the new address and tells the old one`:
    - The code goes to the new address, and the notice goes to the old one with subject `Your Duel Binder sign-in email was changed`.
    - Before confirming, the old address still signs in.
  - `changeEmail to a taken address is refused`.
  - `removeSignIn('email') drops the password; not when it's the last`.
  - `listSignIns shows the address`.
  - `merge-undo.test.ts` `merge undo moves the email sign-in and its password back`: merge an email account into a Discord one, undo, then the email password signs in to the restored id.
  - `merge-undo.test.ts` `undo leaves the email off when the address was taken since`: remove email from the survivor after the merge, sign up the address elsewhere, then undo → no error, the restored account has no email, and the other account keeps it.
  - `account-delete.test.ts` `deleting frees the email at once`: delete → the same address can `create`.
  - `admin-stats.test.ts`: the counts include `email`.
- [ ] **Step 2: Run them to verify they fail**
  Run: `npm test -- tests/portal/email-account.test.ts tests/portal/merge-undo.test.ts tests/portal/account-delete.test.ts tests/portal/admin-stats.test.ts`
  Expected: FAIL. The channels are unknown.
- [ ] **Step 3: Implement.** If the undo-conflict test fails, change `undoMerge` so that a moved sign-in whose subject now belongs to someone else is skipped and listed in the admin response. That is the spec's "undo reports it".
- [ ] **Step 4: Run the tests to verify they pass**, plus `tests/portal/account-rpc.test.ts tests/portal/link.test.ts tests/portal/merge.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(portal): add, change and remove the sign-in email`

### Task 7: Browser pages (web portal and /scan/ in a browser)

**Files:**
- Create: `workers/portal/src/emailPages.ts`
- Modify: `workers/portal/src/app.ts`:
  - `GET /auth/email` (email form)
  - `POST /auth/email/form/:step`
  - `GET /auth/email/match`
  - `GET /auth/email/claim`
- Modify: `workers/portal/src/home.ts` (a "Continue with email" link under Sign in with Discord when enabled)
- Modify: `src/phone/SignIn.tsx` (browser branch: an email link to `/auth/email?next=scan` under the Discord link when `/auth/email/status` says enabled)
- Test: `tests/portal/email-pages.test.ts` (new), `tests/portal/site-page.test.ts` or the home tests, `tests/renderer/phoneSignIn.test.tsx` (or wherever the phone SignIn tests live)

**Interfaces:**
- Consumes: `runEmailStep`, `EMAIL_COPY`.
- Every form POST must pass `fromPublicOrigin`, else 403. Hidden fields carry `ticket`, `email` and `next` (`scan` or none). The `email_claim` and `email_link` tickets live in HttpOnly cookies, as `oauth_state` does.
- `signed-in` sets `cookie('session', …)` with a web session (`mintSession` kind `web`), then answers 303 to `/scan/` when `next=scan`, else `/`.
- The page shell matches `renderHome`: the same stylesheet, `.btn` classes, `esc()` on every value, and no scripts.
- The code input is `inputmode="numeric" autocomplete="one-time-code" maxlength="6"`. A single field is fine here; the six boxes are the apps'.
- The match page:
  - Discord in `providers` → a "Sign in with Discord to link" button that POSTs `form/link-discord`. That sets `email_link` and redirects to `/auth/discord/start?link=email`.
  - Apple-only → only "Make a separate account", plus the line "You can link them later from the Duel Binder iPhone app."

- [ ] **Step 1: Write the failing tests** in `email-pages.test.ts`:
  - `the email page posts to form/check`.
  - `a full browser sign-up ends with a session cookie on /`.
  - `next=scan ends on /scan/`.
  - `a POST from another origin is refused`.
  - `user input is escaped`: email `<b>@x.io` comes back as `&lt;b&gt;`.
  - `errors show the copy on the same step`: a wrong password page contains "That password doesn't match." and a Forgot password? button.
  - `claim page uses the cookie, never a ticket field`.
  - Home: `shows Continue with email only when enabled`.
  - Phone browser SignIn: `shows the email link when enabled`.
- [ ] **Step 2: Run them to verify they fail**
  Run: `npm test -- tests/portal/email-pages.test.ts`
  Expected: FAIL with 404.
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run the tests to verify they pass**, plus `tests/portal/web-csp.test.ts` and the home/phone tests touched. Expected: PASS.
- [ ] **Step 5: Commit** `feat(portal): email sign-in pages for the browser`

### Task 8: The app flow component and the phone apps

**Files:**
- Create: `src/renderer/src/features/account/EmailSignIn.tsx`
- Create: `src/renderer/src/features/account/EmailClaim.tsx`
- Create: `src/renderer/src/features/account/CodeBoxes.tsx`
- Create: `src/phone/emailAuth.ts`
- Modify: `src/phone/SignIn.tsx`, `src/phone/nativeSignIn.ts`
- Test: `tests/renderer/emailSignIn.test.tsx`, `tests/renderer/phoneEmailSignIn.test.tsx`, `tests/renderer/nativeSignIn.test.ts` (extend the existing file if there is one)

**Interfaces:**
- Produces:
  - `interface EmailAuthClient { step(step: EmailStep, body: Record<string, unknown>): Promise<EmailAuthView>; linkDiscord?(ticket: string): Promise<EmailAuthView>; linkApple?(ticket: string): Promise<EmailAuthView> }`. It rejects with `Error(message)` carrying the portal's copy.
  - `EmailSignIn({ client, onSignedIn(user: Me, created: boolean), onBack() })`. Screens follow the spec's flow: email → password or create → code → new-password, plus match.
    - It shows `EMAIL_COPY.oneBox` under the box.
    - Wrong password puts the copy next to Forgot password?.
    - On the code screen, Send a new code waits 60 seconds after each send, and Back returns to the email.
    - On the match screen, the Link buttons show only when the client has `linkDiscord` / `linkApple` and the provider is in `providers`. With no usable button it shows only "Make a separate account" and the line from Task 7.
  - `EmailClaim({ email, provider, client, onSignedIn, onForgot() })`: a password box, Link, Forgot password? and Make a separate account. Copy: `matchClaim(provider)`.
  - `CodeBoxes({ value, onChange })`: six inputs. Pasting or autofilling six digits fills them all. The first has `autocomplete="one-time-code"`.
  - In `src/phone/emailAuth.ts`:
    - `phoneEmailClient(store: Pick<PhoneStore, 'signIn'>, doFetch = fetch): EmailAuthClient`. It POSTs `${PORTAL_ORIGIN}/auth/email/<step>`. On `signed-in` it calls `store.signIn(token, user)` and returns the view without the token. `linkDiscord` uses `nativeSignIn({ intent: 'link' })`; `linkApple` (iOS only) uses `appleSheet()`.
    - `emailSignInEnabled(doFetch): Promise<boolean>`, which is false on any failure.
  - `nativeSignIn` (sign-in intent) adds `offer=email` and resolves either `{ token, user }` or `{ claim, email, verifier }`. `appleSignIn` sends `offerLink: true` and may resolve `{ claim, email }`.
- Phone `SignIn` (native):
  - iOS order: Apple, Discord, then a "Continue with email" outline button. Android: Discord, then email. The email button appears only when `emailSignInEnabled`.
  - A claim from Discord or Apple shows `EmailClaim`. Its client sends `verifier` with `claim` / `claim-separate`.
  - A `created` sign-in goes on to the existing username prompt (`usernameChosen: false` already triggers it).

- [ ] **Step 1: Write the failing tests**
  - `emailSignIn.test.tsx`, driving a fake `EmailAuthClient`:
    - `new email → create → code → signed in`.
    - `known email → wrong password shows the copy and Forgot password?`.
    - `forgot → code → new password signs in`.
    - `pasting 123456 into the first box fills all six`.
    - `Send a new code is disabled for 60 seconds`.
    - `match without linkDiscord shows only Make a separate account`.
    - `match with linkDiscord calls it with the ticket`.
  - `phoneEmailClient`: `stores the token and hides it from the view` (`store.signIn` called with the token, and the returned view has no `token`).
  - Phone SignIn: `android shows Discord then email when enabled` and `hides email when status fails`.
  - `nativeSignIn adds offer=email and returns a claim`.
- [ ] **Step 2: Run them to verify they fail**
  Run: `npm test -- tests/renderer/emailSignIn.test.tsx tests/renderer/phoneEmailSignIn.test.tsx`
  Expected: FAIL. The modules are missing.
- [ ] **Step 3: Implement.** Use the phone's `BUTTON` class family for the phone buttons, and the renderer's `Button` inside the shared component.
- [ ] **Step 4: Run the tests to verify they pass**, plus the existing phone SignIn and linking tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(app): email sign-in on the phone apps`

### Task 9: Desktop

**Files:**
- Create: `src/main/cloud/emailAuth.ts`
- Modify: `src/main/cloud/signIn.ts`:
  - `signInWithBrowser` takes `intent?: 'link'` and `offer?: boolean`.
  - The loopback accepts `claim` + `email`, and resolves `{ claim, email, verifier }`.
  - With `intent: 'link'` it resolves `{ code, verifier }` without exchanging.
- Modify: `src/main/cloud/account.ts`:
  - `AccountService` gains `emailAuth`, `emailLinkDiscord`, `claim` and `emailEnabled`.
  - `AccountStatus.claim?: { email: string; provider: 'discord' }`. Main keeps the ticket and verifier.
- Modify: `src/main/ipc/handlers.ts`, `src/shared/ipc.ts`, `src/shared/types.ts`:
  - Channels `account:emailAuth`, `account:emailLinkDiscord`, `account:claim`, `account:emailEnabled`.
  - The Task 6 RPC channels are forwarded through `account.portal`.
- Modify: `src/renderer/src/features/account/SignInScreen.tsx` (a "Continue with email" outline button under Sign in with Discord when enabled; `EmailSignIn` over `api.account`; `EmailClaim` when `status.claim`)
- Modify: `src/renderer/src/web/httpApi.ts` and `src/phone/api.ts` (the Task 6 channels; `emailAuth` and friends reject `Not available here` on the web)
- Test: `tests/main/cloud/emailAuth.test.ts`, `tests/main/cloud/signIn.test.ts`, `tests/main/cloud/account.test.ts`, `tests/renderer/signInScreen.test.tsx` (use the existing file names where they differ)

**Interfaces:**
- `emailAuthRequest(portalUrl, step, body, doFetch): Promise<EmailAuthReply>`. It rejects with the portal's `error` text, or `"Couldn't reach Duel Binder"` when offline.
- `AccountService`:
  - `emailAuth(step, body): Promise<EmailAuthView>`. On `signed-in` it calls the existing `becomeSignedIn(token, user)` and strips the token.
  - `emailLinkDiscord(ticket)`: the browser link flow, then step `link-discord`.
  - `claim(password: string | null)`: the stored ticket and verifier → `claim` or `claim-separate`, then sign-in, and clear `status.claim`.
  - Discord sign-in passes `offer: true`.

- [ ] **Step 1: Write the failing tests**
  - `signIn.test.ts`:
    - `offer adds offer=email and a claim callback resolves the claim`.
    - `intent link resolves the code without exchanging`.
  - `account.test.ts`:
    - `emailAuth signed-in stores the token and the renderer never sees it`.
    - `a Discord claim shows in status and claim(password) signs in`.
    - `claim(null) makes the separate account`.
  - `signInScreen.test.tsx`:
    - `shows Continue with email only when enabled`.
    - `shows the claim screen when status.claim is set`.
- [ ] **Step 2: Run them to verify they fail**
  Run: `npm test -- tests/main/cloud tests/renderer/signInScreen.test.tsx`
  Expected: FAIL on the new tests.
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run the tests to verify they pass.** Expected: PASS, with the existing sign-in tests unchanged.
- [ ] **Step 5: Commit** `feat(desktop): email sign-in and Discord claims`

### Task 10: Settings UI for email

**Files:**
- Create: `src/renderer/src/features/settings/EmailDialogs.tsx`
- Modify: `src/renderer/src/features/settings/SignInMethods.tsx`, `src/phone/Settings.tsx`
- Test: `tests/renderer/signInMethods.test.tsx` (extend), `tests/renderer/phoneSettings.test.tsx` (extend)

**Interfaces:**
- Consumes: the `Api.account` methods from Task 6, `CodeBoxes` from Task 8, `Me.emailSignIn`.
- `LABEL.email = 'Email'`. The email row shows `Email · <address>`, with Change password, Change email and Remove.
- "Add email" shows when `user.emailSignIn` is true and the account has no email.
- Dialogs:
  - `AddEmailDialog({ onMerge? })`: email + password → code → done.
    - A `merge` result calls `onMerge(ticket, preview)` when given. The phone passes its existing merge state setter. Without `onMerge` it shows `EMAIL_COPY.mergeOnPhone`.
    - `has-provider` shows `alsoHas(provider)`.
  - `ChangePasswordDialog`: current, new.
  - `ChangeEmailDialog`: current password, new email → code → done.
- Each refreshes the `['account', 'signIns']` query on success.

- [ ] **Step 1: Write the failing tests**
  - `shows the address and Change password for an email sign-in`.
  - `Add email hidden without emailSignIn`.
  - `add email → code → listed`.
  - `a merge result on desktop shows the phone copy`.
  - `phone: a merge result opens the merge dialog`.
  - `change password shows the portal's error`.
- [ ] **Step 2: Run them to verify they fail**
  Run: `npm test -- tests/renderer/signInMethods.test.tsx tests/renderer/phoneSettings.test.tsx`
  Expected: FAIL on the new tests.
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run the tests to verify they pass.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(app): email in Settings → Sign-in methods`

### Task 11: Wiring, the switch and the owner's steps

**Files:**
- Modify: `workers/portal/wrangler.toml`:
  - `[[send_email]]` with `name = "EMAIL"`, and allowed sender `no-reply@duelbinder.com` if the binding supports restricting it.
  - `[vars] EMAIL_SIGN_IN = "off"`.
- Modify: `workers/portal/src/index.ts` (`WorkerEnv.EMAIL?: SendEmail`; `email: this.env.EMAIL ? bindingSender(this.env.EMAIL) : undefined`)
- Modify: `workers/portal/README.md` (owner steps: onboard duelbinder.com in Email Sending; check the SPF/DKIM/DMARC records; deploy; send one test sign-up to yourself; then set `EMAIL_SIGN_IN = "on"` and deploy again)
- Test: `npm run typecheck` (or the repo's equivalent) and the Worker's build check

- [ ] **Step 1: Before writing the binding, look up the current `send_email` sending config and the `SendEmail` type** in the Cloudflare docs (`cloudflare-docs` search: "Email Service send_email binding wrangler.toml"). Use exactly what they say.
- [ ] **Step 2: Implement the wiring and the README steps**
- [ ] **Step 3: Run the checks**
  Run: `npm run typecheck && cd workers/portal && npx wrangler deploy --dry-run --outdir /tmp/portal-dry`
  Expected: no type errors. The dry run lists the `EMAIL` binding and `EMAIL_SIGN_IN = "off"`.
- [ ] **Step 4: Run the full suite**
  Run: `npm test`
  Expected: PASS.
- [ ] **Step 5: Commit** `chore(portal): wire the email binding behind EMAIL_SIGN_IN`
