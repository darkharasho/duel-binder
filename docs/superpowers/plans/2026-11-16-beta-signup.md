# Phone App Beta Signup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A public duelbinder.com/beta page where people agree to a disclaimer and ask to join the Android or iPhone beta, plus an admin Beta tab to copy emails, mark people added (emailing them) or declined, and count Android testers toward 12.

**Architecture:** The site page (site host, no Durable Object) renders a plain HTML form that POSTs to the app host's `POST /beta`, which the Durable Object handles: validate, store in a new `beta_requests` table, 303 back to `SITE_URL/beta?sent=1` (or `?error=<code>`). Admin JSON routes `GET /admin/beta` and `POST /admin/beta/decide` back a new Beta tab in `adminPage.ts`; marking added sends an email through the existing `EmailSender`.

**Tech Stack:** Cloudflare Worker + Durable Object SQLite (better-sqlite3 in tests), TypeScript, vitest.

**Spec:** `docs/superpowers/specs/2026-11-16-beta-signup-design.md`

## Global Constraints

- Platforms are exactly `android` and `ios` (shown as "Android" and "iPhone").
- Statuses are exactly `pending`, `added`, `declined`.
- No sign-in to ask. Spam guards: honeypot field `website` (filled → pretend success, store nothing), per-IP limit, one row per email + platform.
- Android email link comes from Worker var `BETA_ANDROID_OPTIN_URL` (set to `https://play.google.com/apps/internaltest/4699025211362629714` in wrangler.toml).
- No email on Decline.
- Run vitest with `--maxWorkers=2`. Root `npm run typecheck`, `npm run lint`, prettier must pass.
- Next server migration name is `server-47`.

## Review Focus

1. Same email in different case or with spaces, asked twice → one row (email trimmed + lowercased before storing).
2. A POST to `/beta` from an origin other than `SITE_URL` (or none) → refused with 403, nothing stored.
3. Overlong or missing fields (name/referred/email > 200 chars, bad email, no checkbox, unknown platform) → `?error=` redirect, nothing stored.
4. Marking an already-added row added again → no second email.
5. No email binding (`deps.email` undefined) → marking added still succeeds; the response says the email wasn't sent.

---

### Task 1: Store requests — migration, `POST /beta`

**Files:**
- Modify: `workers/portal/src/migrate.ts` (append `server-47`)
- Modify: `workers/portal/src/authLimits.ts` (add `'beta-ip'`: max 5, windowMs 24 h)
- Create: `workers/portal/src/beta.ts`
- Modify: `workers/portal/src/app.ts` (route `POST /beta` before the admin routes)
- Test: `tests/portal/beta.test.ts`

**Interfaces:**
- Produces: table `beta_requests (id INTEGER PRIMARY KEY, email TEXT NOT NULL, platform TEXT NOT NULL, name TEXT NOT NULL, referred_by TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL, decided_at TEXT, UNIQUE (email, platform))`.
- Produces: `export type BetaPlatform = 'android' | 'ios'`, `export type BetaStatus = 'pending' | 'added' | 'declined'`, `export async function betaSubmitRoute(req: Request, deps: AppDeps): Promise<Response>` in `beta.ts`.
- Produces (for Task 3): error codes in the redirect: `agree`, `platform`, `email`, `name`, `limit`.

- [ ] **Step 1: Write the failing tests** in `tests/portal/beta.test.ts` (deps built like `tests/portal/costs.test.ts`; helper `post(fields, origin = 'https://site.test', ip = '1.2.3.4')` sends `application/x-www-form-urlencoded` to `BASE + '/beta'` with `origin` and `cf-connecting-ip` headers):
  - `stores a request and sends the person back to the site's thank-you`: fields `{agree:'on', platform:'android', email:' Sam@Example.com ', name:'Sam', referred:'Dub'}` → status 303, `location` = `https://site.test/beta?sent=1`; row `{email:'sam@example.com', platform:'android', name:'Sam', referred_by:'Dub', status:'pending'}`.
  - `keeps one row when the same email asks twice for the same platform`: post twice with `SAM@example.com` / `sam@example.com` → both 303 `?sent=1`, `COUNT(*) = 1`; then `platform:'ios'` → 2 rows.
  - `sends errors back without storing`: missing agree → `?error=agree`; `platform:'web'` → `?error=platform`; `email:'nope'` → `?error=email`; `name:''` → `?error=name`; `name:'x'.repeat(201)` → `?error=name`; table empty.
  - `pretends to accept a filled honeypot`: `website:'http://spam'` → 303 `?sent=1`, table empty.
  - `refuses posts not from the site`: origin `https://evil.test` → 403; no origin header → 403; table empty.
  - `limits one address to five requests a day`: 6 posts with different emails, same ip → sixth is `?error=limit`, 5 rows.

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run --maxWorkers=2 tests/portal/beta.test.ts`
Expected: FAIL (`/beta` returns 404 / no such table).

- [ ] **Step 3: Implement.** Migration `server-47` with the table above. `betaSubmitRoute`: 403 unless `req.method === 'POST'` and `origin` header equals `new URL(deps.env.SITE_URL).origin`; read `req.formData()`; honeypot → redirect sent; validate (email: trimmed, lowercased, ≤ 200, matches `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`; name: trimmed, 1–200; referred: trimmed, 0–200; agree === 'on'; platform in the two); check order agree, platform, email, name; then `takeLimit(db, 'beta-ip', clientIp(req), deps.now())` → `limit`; `INSERT OR IGNORE`. Redirect with `new Response(null, {status: 303, headers: {location}})`.

- [ ] **Step 4: Run tests** — same command. Expected: PASS.

- [ ] **Step 5: Commit** `feat(portal): store phone beta requests from the site form`

### Task 2: Admin API + "you're in" email

**Files:**
- Modify: `workers/portal/src/beta.ts`
- Modify: `workers/portal/src/app.ts` (route `/admin/beta`, `/admin/beta/decide` before the `/admin/` catch-all), `AppDeps.env` gets `BETA_ANDROID_OPTIN_URL?: string`
- Modify: `workers/portal/wrangler.toml` (`BETA_ANDROID_OPTIN_URL` var)
- Test: `tests/portal/beta.test.ts`

**Interfaces:**
- Consumes: Task 1 table and types.
- Produces: `GET /admin/beta` → `{ requests: BetaRequest[], androidAdded: number }`, `BetaRequest = { id, email, platform, name, referredBy, status, createdAt, decidedAt }`, ordered pending first, then newest first. `POST /admin/beta/decide` JSON `{ id: number, status: 'added' | 'declined' }` → `{ ok: true, emailed: boolean }`; 404 unknown id; admin-only exactly like `adminTestersRoute` (`isAdmin`, `adminWriteAllowed`, `isJson`).
- Produces: `export function betaAddedMessage(r: { email: string; name: string; platform: BetaPlatform }, androidOptIn: string | undefined): EmailMessage` using `brandedHtml`.

- [ ] **Step 1: Write the failing tests** (admin = `Bearer ${TOKEN}` as in costs.test.ts; `sent: EmailMessage[]` captured by a fake `email` dep):
  - `lists requests for the admin only`: unauthenticated GET → 404; admin GET lists rows in order, `androidAdded` 0.
  - `marking added emails the Play link once`: Android row → decide added → `{ok:true, emailed:true}`, one message to the row's email whose `text` contains the opt-in URL; `androidAdded` 1; decide added again → `emailed:false`, still one message.
  - `iPhone email points to TestFlight`: message text contains `TestFlight`.
  - `declining sends nothing`; `unknown id is 404`; `bad status is 400`.
  - `still marks added without an email binding`: `deps.email = undefined` → `{ok:true, emailed:false}`, status `added`.

- [ ] **Step 2: Run to see them fail** — `npx vitest run --maxWorkers=2 tests/portal/beta.test.ts`. Expected: new tests FAIL with 404s.

- [ ] **Step 3: Implement** `adminBetaRoute(req, deps)`; email only when the row was `pending`/`declined` and becomes `added` and `deps.email` exists; set `decided_at = deps.now().toISOString()`. Message: subject "You're in the Duel Binder beta"; Android body tells them to open the opt-in link signed in with that Google account, then install from Play (if the var is unset, say the link is coming); iPhone body says Apple will email a TestFlight invite to that Apple ID. Email send failure → mark anyway, `emailed:false`.

- [ ] **Step 4: Run tests** — Expected: PASS.

- [ ] **Step 5: Commit** `feat(portal): admin beta list, decisions and you're-in email`

### Task 3: The /beta page on the site

**Files:**
- Create: `workers/portal/src/site/beta.ts`
- Modify: `workers/portal/src/site/handler.ts` (serve GET/HEAD `/beta`), `workers/portal/src/site/page.ts` (Phone section link)
- Test: `tests/portal/site-beta.test.ts`

**Interfaces:**
- Consumes: Task 1 error codes, form field names `agree`, `platform`, `email`, `name`, `referred`, `website`.
- Produces: `export function renderBeta(view: { appUrl: string; sent: boolean; error: string | null }): string`, built on `renderLegal` (path `/beta`), form `method="post" action="${appUrl}/beta"`.

- [ ] **Step 1: Write the failing tests** via `handleSite` with `SiteDeps` as in `site-page.test.ts`:
  - `serves the beta page with the disclaimer and a form that posts to the app`: 200; body contains `action="https://app.test/beta"`, `name="agree"` with `required`, both platform options, `name="website"`, and the disclaimer lines (crash, unsynced scans, invite through Google or Apple).
  - `shows thanks after sending`: `/beta?sent=1` → contains "you'll get an email when you're in" and no form.
  - `shows the error and keeps the form`: `/beta?error=email` → a readable message for each code (`agree`, `platform`, `email`, `name`, `limit`); unknown code → generic message.
  - `links the home page's Phone section to /beta` (renderPage output contains `href="/beta"`).

- [ ] **Step 2: Run to see them fail** — `npx vitest run --maxWorkers=2 tests/portal/site-beta.test.ts`. Expected: FAIL (asset fetch 404).

- [ ] **Step 3: Implement** the page and handler route; honeypot field hidden with CSS (`position:absolute;left:-9999px`, `tabindex="-1"`, `autocomplete="off"`). Add "Want the store app? <a href="/beta">Join the beta</a>." to the Phone paragraph.

- [ ] **Step 4: Run tests** — Expected: PASS; also `tests/portal/site-page.test.ts` still passes.

- [ ] **Step 5: Commit** `feat(site): beta signup page with disclaimer`

### Task 4: Admin Beta tab

**Files:**
- Modify: `workers/portal/src/adminPage.ts` (TABS gets `'beta'` after `'testers'`; nav link; `<section data-tab id="beta" hidden>`; `loadBeta()` in the refresh handler and startup)
- Test: `tests/portal/admin-page.test.ts`

**Interfaces:**
- Consumes: Task 2 routes and shapes.

- [ ] **Step 1: Write the failing test** `has a Beta tab`: page HTML contains `href="#beta"`, `id="beta"`, `'beta'` in TABS, and `fetch('/admin/beta'`.

- [ ] **Step 2: Run to see it fail** — `npx vitest run --maxWorkers=2 tests/portal/admin-page.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** `loadBeta()`: header "Android added: N of 12"; per platform (Android, iPhone) a "Copy emails" button (pending emails joined with `, ` via `navigator.clipboard.writeText`) and a table (Name, Email, Who sent them, Asked, Status, actions); pending rows get Mark added / Decline buttons posting JSON to `/admin/beta/decide` then reloading; show "email not sent" note when `emailed` is false on added.

- [ ] **Step 4: Run tests + full checks**
Run: `npx vitest run --maxWorkers=2 tests/portal && npm run typecheck && npm run lint && npx prettier --check workers/portal/src tests/portal`
Expected: all pass.

- [ ] **Step 5: Commit** `feat(admin): Beta tab with copy emails and decisions`
