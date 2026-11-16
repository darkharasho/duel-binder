# Supporter Tier Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An optional $3/month or $25/year supporter subscription through Stripe. It is tied to the account, nothing is locked, and supporters get a heart badge and an opt-in spot on a thanks list.

**Architecture:**
- The portal Durable Object owns a `supporters` table.
- Signed-in clients ask for a Checkout or Customer Portal URL through new RPC channels, the way `prefs:*` works.
- Stripe's webhook reaches `POST /stripe/webhook` in the DO. The DO checks the signature, then re-reads the subscription from Stripe and writes its latest state. Re-reading makes replayed and out-of-order events harmless.
- The renderer shares one `SupporterSection` across desktop, web and phone Settings, plus a `SupporterHeart` badge.

**Tech Stack:**
- Cloudflare Worker and Durable Object SQLite.
- Stripe REST through plain `fetch` with form encoding, and WebCrypto HMAC. No SDK.
- React and TypeScript, with Vitest (run through the root `npm test`, maxWorkers=2).

**Spec:** `docs/superpowers/specs/2026-11-16-supporter-tier-design.md`. The owner approved its four decisions on 2026-11-16.

## Global Constraints

- **Price:** $3/month or $25/year. The price ids come from wrangler vars `STRIPE_PRICE_MONTH` and `STRIPE_PRICE_YEAR`. No prices in code.
- **Secrets:** `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are wrangler secrets, never in code, logs or error text. `STRIPE_SECRET_KEY` is a **restricted key** (`rk_…`) with write access only to Customers, Checkout Sessions, Subscriptions and Customer portal (Stripe best practice).
- **Sandbox first:** development uses a Stripe sandbox; live keys only at launch.
- **Checkout:** never pass `payment_method_types`; pass `integration_identifier=duelbinder-supporter-kqzmwhrt`. No `automatic_tax` (Stripe Tax off, owner decision).
- **Gate:** `SUPPORTER_ENABLED = "on"`. Any other value means checkout refuses and every client hides the section. Existing rows still show their badges.
- **Nothing locked:** no feature checks the supporter flag except the badge, the thanks list and the Settings section.
- **No nagging:** no prompts, banners or counts anywhere outside Settings, the site footer link and the `/support` page.
- **No buy buttons in store builds:** builds where `isNativeApp()` is true show only status and *Manage*.
- **Stripe API version:** pin the `Stripe-Version: 2026-10-28.endive` header (latest) on every call. The period end comes from `items.data[0].current_period_end`. Invoices and charges don't carry a top-level `subscription` on this version, so the webhook never reads one there.
- **Webhook tolerance:** 300 s on the `t=` timestamp.
- **DO SQLite:** one statement per table; no compound UNIONs (memory: do-sqlite-compound-limit).
- **Copy for non-supporters:** "Hosting, card art and price lookups cost money every month. Supporting keeps the app free for everyone." Buttons read "$3 / month" and "$25 / year".
- **Ship order:** deploy the portal before tagging the release.

## Rulings against the spec (made while planning)

1. **Status comes from the `supporter:status` RPC, not from a new `/api/me` field.**
   - Why: the desktop caches `Me` in the main process. An RPC that Settings refetches on window focus picks up a purchase made in the browser.
   - Cost if wrong: one extra small request when Settings opens.
2. **Supporter rule is `status IN ('active','trialing','past_due')`.**
   - Why: Stripe keeps a cancel-at-period-end subscription `active` until the period ends. The spec's `OR current_period_end > now` clause would keep the badge after an immediate refund-cancel.
   - Cost if wrong: a delayed webhook ends the badge a few seconds late.
3. **The thanks page is one static page, `/supporter/thanks`, that doesn't poll.**
   - Why: a desktop buyer is often signed out in the browser, so polling `/api/me` there fails. The Settings section refetches on focus instead.
   - `?cancelled=1` serves the same page as the cancel URL.
4. **Early access needs no code in v1.**
   - Why: the owner adds supporters to the existing Testers tab per game. The Supporters admin tab lists them so this is easy.
   - Cost if wrong: one manual step per preview.

## Review Focus

1. **Webhook for a customer we don't know** (deleted account, or test events). Expect 200 with no row written and no throw. Tested in Task 2.
2. **Checkout pressed twice, or for both plans.** Expect one Stripe customer reused, never two. Tested in Task 3.
3. **An account with a live subscription is deleted.**
   - The Stripe cancel runs before rows go.
   - A failed cancel is logged, and the delete still succeeds.
   - Tested in Task 4.
4. **Store build with a lapsed customer.** Expect *Manage* still shown, so they can resubscribe or see invoices, but no buy buttons. Tested in Task 6.
5. **The feature switched off with existing supporters.**
   - Badges stay.
   - Checkout throws "Supporter subscriptions aren't open yet".
   - The section is hidden.
   - Tested in Tasks 3 and 6.

---

### Task 1: Supporters table and model

**Files:**
- Modify: `workers/portal/src/migrate.ts`. Append step `server-48` after `server-47`.
- Create: `workers/portal/src/supporters.ts`
- Test: `tests/portal/supporters.test.ts`

**Interfaces:**
- Produces, in `src/shared/supporter.ts` (new, shared with clients):
  ```ts
  export type SupporterPlan = 'month' | 'year'
  export interface SupporterStatus {
    enabled: boolean          // SUPPORTER_ENABLED === 'on'
    hasCustomer: boolean      // a Stripe customer exists, so Manage works
    supporter: {
      plan: SupporterPlan
      since: string           // ISO
      until: string | null    // current period end, ISO
      cancelling: boolean     // cancel_at_period_end
      showOnSite: boolean
    } | null
  }
  ```
- Produces, in `supporters.ts`:
  - `isActiveStatus(status: string): boolean`
  - `writeSubscription(db, userId: number, sub: StripeSubscription, now: Date): void`
  - `supporterOf(db, userId): SupporterStatus['supporter']`
  - `supporterIds(db, ids: number[]): Set<number>`
  - `setShowOnSite(db, userId, on: boolean): void`
  - `thanksNames(db): string[]`
  - `StripeSubscription`, the subset read: `{ id, customer, status, cancel_at_period_end, items: { data: [{ current_period_end, price: { unit_amount, recurring: { interval } } }] } }`

- [ ] **Step 1: Write the failing tests** in `tests/portal/supporters.test.ts`. Use `seededServerDb` and `addUser` from `./helpers`.
  - `isActiveStatus`: true for `active`, `trialing` and `past_due`. False for `canceled`, `incomplete`, `incomplete_expired`, `unpaid` and `paused`.
  - `writeSubscription` on a first `active` year subscription (unit_amount 2500, period end `2027-11-16T00:00:00Z` as epoch seconds) produces:
    `supporterOf → { plan: 'year', since: NOW, until: '2027-11-16T00:00:00.000Z', cancelling: false, showOnSite: false }`
  - Writing `canceled` afterwards makes `supporterOf` null. Writing `active` again a month later keeps the first `since`.
  - `since` stays null while the only status seen is `incomplete`.
  - `supporterIds(db, [a, b, c])` returns only the active ids.
  - `thanksNames` lists `display_name ?? username` of active supporters with `show_on_site = 1`, ordered by since. Lapsed and opted-out users are excluded.
- [ ] **Step 2: Run** `npm test -- tests/portal/supporters.test.ts`. Expected: FAIL, because the module isn't found.
- [ ] **Step 3: Implement the migration** as step `server-48`:
  ```sql
  CREATE TABLE supporters (user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    stripe_customer_id TEXT NOT NULL UNIQUE, stripe_subscription_id TEXT, plan TEXT,
    status TEXT NOT NULL DEFAULT 'none', amount_cents INTEGER, current_period_end TEXT,
    cancel_at_period_end INTEGER NOT NULL DEFAULT 0, since TEXT,
    show_on_site INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL);
  ```
- [ ] **Step 4: Implement `supporters.ts`.** The `plan` comes from `price.recurring.interval`. `since` is set on the first active write only: `COALESCE(since, ?)`.
- [ ] **Step 5: Run.** Expected: PASS. Also run `npm test -- tests/portal/migrate.test.ts`. Expected: PASS.
- [ ] **Step 6: Commit** with message `feat(portal): supporters table and model`.

### Task 2: Stripe client and webhook

**Files:**
- Create: `workers/portal/src/stripe.ts`
- Modify:
  - `workers/portal/src/app.ts`: the `Env` fields below, and the route `POST /stripe/webhook` before the `/api/rpc/` block.
  - `workers/portal/src/meter.ts`: `areaOf` maps `/stripe/` to `'supporter'`, if it has a fixed area list.
- Test: `tests/portal/stripe-webhook.test.ts`

**Interfaces:**
- Consumes `writeSubscription` and `StripeSubscription` from Task 1.
- Produces:
  - `Env` fields: `STRIPE_SECRET_KEY?`, `STRIPE_WEBHOOK_SECRET?`, `STRIPE_PRICE_MONTH?`, `STRIPE_PRICE_YEAR?`, `SUPPORTER_ENABLED?`.
  - `stripeCall<T>(deps: AppDeps, method: 'GET' | 'POST' | 'DELETE', path: string, form?: Record<string, string>): Promise<T>`. It form-encodes, sends `Authorization: Bearer` and `Stripe-Version`, and throws `StripeError(status, message)` on any non-2xx response.
  - `verifyStripeSignature(secret: string, header: string | null, body: string, now: Date): Promise<boolean>`
  - `stripeWebhookRoute(req, deps): Promise<Response>`

- [ ] **Step 1: Write the failing tests.**
  - Build the signature with `node:crypto` `createHmac('sha256', secret).update(`${t}.${body}`)`.
  - Use a fake `deps.fetch` that answers `GET /v1/subscriptions/sub_1` from a mutable object and records calls.
  - Signature checks:
    - A valid signature passes.
    - A wrong secret answers 400.
    - A `t` 301 s old answers 400.
    - A missing header answers 400.
    - A header with two `v1=` entries, one right, passes.
  - `checkout.session.completed` with `client_reference_id: String(alice)`, `customer: 'cus_1'`, `subscription: 'sub_1'` makes alice a supporter. The row's customer is `cus_1`.
  - `customer.subscription.updated` for `cus_1` re-reads `sub_1`. If Stripe says `canceled`, the row becomes canceled, even when the event body says `active`. This shows the latest state wins.
  - A replayed old `customer.subscription.created` after the cancel leaves the row canceled.
  - `invoice.payment_failed` for `customer: 'cus_1'` while Stripe says `past_due` leaves alice still a supporter.
  - `charge.refunded` for `cus_1` after an owner refund-cancel re-reads and leaves the row canceled (risk events: `charge.refunded`, `charge.dispute.created`, `radar.early_fraud_warning.created` all just re-sync the customer).
  - An event for an unknown customer `cus_x` answers 200 and writes no row.
  - An unknown event type answers 200 and makes no Stripe calls.
  - With `STRIPE_WEBHOOK_SECRET` unset, the route answers 404.
- [ ] **Step 2: Run** `npm test -- tests/portal/stripe-webhook.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Read the raw body as text once, verify it, then `JSON.parse`.
  - Compare signatures in constant time with `sameString` from `auth.ts`.
  - Handled events: `checkout.session.completed`, `customer.subscription.created|updated|deleted`, `invoice.paid`, `invoice.payment_failed`, `charge.refunded`, `charge.dispute.created`, `radar.early_fraud_warning.created`. Every one resolves to a **customer id** (`data.object.customer`; for the fraud warning, re-read its charge to get the customer).
  - Find the row by `stripe_customer_id`. On `checkout.session.completed` only, if no row matches, use `client_reference_id` when that user exists.
  - Re-sync: `GET /v1/subscriptions?customer=<id>&status=all&limit=1` (newest first) and write it. No subscription: leave the row alone.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** with message `feat(portal): Stripe webhook keeps supporters in step`.

### Task 3: Supporter RPC channels

**Files:**
- Modify:
  - `src/shared/ipc.ts`: an `Api.supporter` block and four `INVOKE` channels.
  - `src/shared/portal.ts`: `PORTAL_CHANNELS`.
  - `workers/portal/src/rpc.ts`: `HANDLERS`.
  - `workers/portal/src/supporters.ts`: the route functions.
  - `workers/portal/wrangler.toml`: commented vars.
- Test: `tests/portal/supporter-rpc.test.ts`

**Interfaces:**
- Consumes `stripeCall` from Task 2, and `supporterOf` and `setShowOnSite` from Task 1.
- Produces these channels:
  - `supporter:status` → `SupporterStatus`
  - `supporter:checkout(plan: SupporterPlan)` → `{ url: string }`
  - `supporter:manage()` → `{ url: string }`
  - `supporter:setShowOnSite(on: boolean)` → `SupporterStatus`
- Produces `Api.supporter: { status(); checkout(plan); manage(); setShowOnSite(on) }` with those returns.

- [ ] **Step 1: Write the failing tests**, through `handle()` with a session the way `account-delete.test.ts` does, and a fake Stripe `fetch`.
  - Signed out, every channel answers 401.
  - `status` with the gate off: `{ enabled: false, hasCustomer: false, supporter: null }`.
  - `checkout('month')` with the gate off: 400 `Supporter subscriptions aren't open yet`.
  - `checkout('week')`: 400.
  - `checkout('year')` creates the customer with `metadata[user_id]`, then a session with these fields, and answers `{ url }`:
    - no `payment_method_types` field at all
    - `integration_identifier=duelbinder-supporter-kqzmwhrt`
    - `mode=subscription`
    - `customer=cus_1`
    - `client_reference_id=<id>`
    - `line_items[0][price]=price_year`
    - `line_items[0][quantity]=1`
    - `success_url=https://portal.test/supporter/thanks`
    - `cancel_url=https://portal.test/supporter/thanks?cancelled=1`
  - A second `checkout('month')` makes no new `POST /v1/customers`.
  - `manage()` without a row: 400 `No subscription to manage`. With one, it posts `billing_portal/sessions` with `customer` and `return_url=<PUBLIC_URL>/supporter/thanks?managed=1`.
  - `setShowOnSite(true)` without being a supporter: 400. As a supporter, it flips the flag and answers the status.
- [ ] **Step 2: Run** `npm test -- tests/portal/supporter-rpc.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - The handlers ignore `scope` and the game.
  - Insert the row with `status 'none'` right after creating the customer, so a double press finds it.
  - Add the commented `STRIPE_PRICE_MONTH`, `STRIPE_PRICE_YEAR` and `SUPPORTER_ENABLED = "off"` lines to wrangler.toml, with a note that the secrets come from `wrangler secret put` and 1Password Private.
- [ ] **Step 4: Run.** Expected: PASS. Also run `npm --prefix workers/portal run typecheck`.
- [ ] **Step 5: Commit** with message `feat(portal): supporter checkout, manage and status`.

### Task 4: Account delete, friends badge flag, admin Supporters, thanks names

**Files:**
- Modify:
  - `workers/portal/src/account.ts`: before the delete transaction, cancel any non-canceled subscription with `DELETE /v1/subscriptions/:id`. Do this for the user and for held merged accounts. Catch and log failures.
  - `src/shared/types.ts`: `FriendUser.supporter?: true`, set only when true.
  - `workers/portal/src/friends.ts`: everywhere `toUser` maps rows, add the flag through `supporterIds`, with one query per list.
  - `src/shared/admin.ts`: `AdminSupporters`.
  - `workers/portal/src/supporters.ts`: `adminSupportersRoute` (GET `/admin/supporters`, `isAdmin` or 404), and `supporterNamesRoute` (GET `/api/supporters/names`, public, `{ names }`, `cache-control: public, max-age=300`).
  - `workers/portal/src/app.ts`: route both.
  - `workers/portal/src/adminPage.ts`: a `supporters` tab after `costs`, with tiles, a table, and `loadSupporters` added to Refresh.
- Test: `tests/portal/supporter-admin.test.ts`, plus new cases in `account-delete.test.ts` and `friends.test.ts`.

**Interfaces:**
- Produces:
  ```ts
  export interface AdminSupporters {
    active: number; monthly: number; yearly: number
    /** Gross monthly-equivalent income in cents: monthly amounts + yearly amounts / 12. */
    monthlyCents: number
    list: { userId: number; username: string; displayName: string | null; plan: SupporterPlan | null;
            status: string; since: string | null; until: string | null; cancelling: boolean; showOnSite: boolean }[]
  }
  ```

- [ ] **Step 1: Write the failing tests.**
  - Deleting an account with `sub_1` active calls `DELETE /v1/subscriptions/sub_1` and removes the rows.
  - When Stripe answers 500 on that cancel, the delete still answers 200.
  - A `canceled` row makes no Stripe call.
  - `friends:overview` marks the supporter friend `supporter: true` and leaves the field out for others.
  - `/admin/supporters` answers 404 for a non-admin. For an admin with one monthly (300¢) and one yearly (2500¢) supporter it answers `active 2`, `monthlyCents 300 + 208 = 508`, with the list newest first.
  - `/api/supporters/names` only lists opted-in active supporters.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Round the yearly part with `Math.round(cents / 12)` per row.
- [ ] **Step 4: Run.** Expected: PASS, plus `tests/portal/admin-page.test.ts` passes.
- [ ] **Step 5: Commit** with message `feat(portal): supporter badges for friends, admin tab, delete cancels`.

### Task 5: Site pages and legal text

**Files:**
- Modify:
  - `workers/portal/src/site/page.ts`: a footer `<a href="/support">Support</a>` before Privacy.
  - `workers/portal/src/site/handler.ts`: route `/support`; `SiteDeps.supporterNames: () => Promise<string[]>`.
  - `workers/portal/src/index.ts`: pass `supporterNames`, which calls `store(new Request(`${env.PUBLIC_URL}/api/supporters/names`))` and returns `[]` on any failure.
  - `workers/portal/src/site/terms.ts`: the "Supporter subscriptions" section from the spec.
  - `workers/portal/src/site/privacy.ts`: the Stripe paragraph from the spec.
- Create:
  - `workers/portal/src/site/support.ts`, with `renderSupport({ appUrl, names })`.
  - `workers/portal/src/supporterThanks.ts`, with `GET /supporter/thanks` on the app host, routed in `app.ts`.
- Test: `tests/portal/site-support.test.ts`

The `/support` page:
- Says what the tier is and what it pays for. Use the Global Constraints copy, and add that nothing is locked.
- Gives the price.
- Says "Become a supporter in Settings → Support Duel Binder" and links to `appUrl`.
- Lists the names, escaped with `escapeHtml`. With no names, the list is left out.

The `/supporter/thanks` page uses the branded app-host page style that `emailPages.ts` uses:
- By default: "Thank you for supporting Duel Binder! Your badge shows in the app within a minute. You can close this tab."
- With `?cancelled=1`: "No charge was made. You can close this tab."
- With `?managed=1`: "Your changes are saved. You can close this tab."

- [ ] **Step 1: Write the failing tests.**
  - The footer has `/support`.
  - `/support` lists `<b>` escaped as `&lt;b&gt;`.
  - A failing `supporterNames` still renders the page.
  - The three thanks variants show their text.
  - Terms contain "Supporter subscriptions" and privacy contains "Stripe".
- [ ] **Step 2: Run** `npm test -- tests/portal/site-support.test.ts tests/portal/site-page.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** with message `feat(site): support page, thanks page, legal text`.

### Task 6: Clients — API wiring, Settings section, badge, usage events

**Files:**
- Modify:
  - `src/main/ipc/handlers.ts`: `'supporter:*'` forwards with `account.portal`, like `'prefs:get'`.
  - `src/main/dev/fakeFriends.ts`: a stub status, if its handler map must be exhaustive.
  - `src/renderer/src/web/httpApi.ts`: `call(...)`.
  - `src/phone/api.ts`: `portal(...)`.
  - The preload, if it lists channels explicitly. Follow how `prefs:get` reaches it.
  - `src/shared/usage.ts`: add `'supporter:checkout'` and `'supporter:manage'` to `USAGE_EVENTS`.
  - `src/renderer/src/lib/usage.ts`: flush them as their own batch, like `buy`.
  - `src/renderer/src/features/settings/SettingsPage.tsx`: `<Section title="Support Duel Binder">` after Account, in both desktop and web layouts.
  - `src/phone/Settings.tsx`: the same section in its own `Group`.
  - `AccountSection.tsx` (`Identity`), `FriendHeader.tsx` and the friends-list row in `FriendsPage.tsx`: `<SupporterHeart />` after the name.
- Create:
  - `src/renderer/src/features/settings/SupporterSection.tsx`
  - `src/renderer/src/components/SupporterHeart.tsx`
- Test: `tests/renderer/supporter-section.test.tsx`, plus a case in `tests/renderer/friends*.test.tsx`.

**Interfaces:**
- Consumes `Api.supporter` and `SupporterStatus` from Task 3, and `FriendUser.supporter` from Task 4.
- Produces:
  - `SupporterSection(props: { signedIn: boolean; store?: boolean })`. `store` defaults to `isNativeApp()`.
  - `SupporterHeart()`: a lucide `Heart`, `size-3.5`, filled, `aria-label="Supporter"` with a matching `title`.

**SupporterSection behaviour.** It uses `useQuery(['supporter'], api.supporter.status, { refetchOnWindowFocus: true })` and shows:
- **Signed out:** the text "Sign in to support".
- **Query failed or `enabled: false` with no supporter and no customer:** nothing.
- **Not a supporter, not a store build:**
  - The copy from Global Constraints and the two buttons.
  - A click calls `track('supporter:checkout')`, then `checkout(plan)`, then opens the URL.
- **Supporter:**
  - "Thank you — supporter since {Month YYYY}".
  - When `cancelling`, also "Ends {date}".
  - A *Manage* button, which calls `track('supporter:manage')` and opens the URL.
  - A *Show my name on the thanks page* switch, wired to `setShowOnSite`.
- **Store build with `hasCustomer` and not a supporter:** only *Manage*.

How a URL opens: `isWeb() && !isNativeApp()` uses `window.location.assign(url)`. Desktop and native use `window.open(url, '_blank', 'noopener')`. Electron and Capacitor send those to the browser. A failed call shows `toast.error(message)`.

- [ ] **Step 1: Write the failing tests** with a mocked `api.supporter`.
  - Signed out shows "Sign in to support" and no buttons.
  - `enabled: false` renders nothing.
  - A non-supporter on web shows both prices. Clicking "$25 / year" calls `checkout('year')` and `location.assign` with the URL.
  - A supporter shows "supporter since November 2026", Manage, and the switch. Toggling calls `setShowOnSite(true)`.
  - `store` with no customer renders nothing. `store` with `hasCustomer` shows Manage only, with no "$3 / month".
  - `cancelling` shows "Ends".
  - The friends row shows `aria-label="Supporter"` only for `supporter: true`.
  - Separate test: `flushUsage` sends `supporter:*` in a batch of its own.
- [ ] **Step 2: Run** `npm test -- tests/renderer/supporter-section.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the new tests, then `npm run typecheck:web && npm run typecheck:phone && npm run typecheck:node`. Expected: PASS, and no errors from the typecheck.
- [ ] **Step 5: Commit** with message `feat: Support Duel Binder section and supporter badge`.

### Task 7: Desktop admin Supporters tab

**Files:**
- Modify:
  - `src/shared/ipc.ts`: `admin.supporters(): Promise<AdminSupporters>` and the `'admin:supporters'` channel.
  - `src/main/ipc/adminHandlers.ts`: `account.admin<AdminSupporters>('/admin/supporters')`.
  - `src/renderer/src/features/admin/adminTabs.ts`: `{ value: 'supporters', label: 'Supporters' }` after `costs`, and `adminKeys.supporters`.
  - `AdminPage.tsx`: render the tab.
- Create: `src/renderer/src/features/admin/SupportersTab.tsx`. It shows tiles for active, monthly and yearly, and monthly income as `$X.XX` gross. It also shows "≈ $Y after Stripe fees", estimated per row as amount − (2.9% + 30¢), with yearly rows ÷ 12. Below that is a table of name, plan, status, since, until and thanks-list.
- Test: a new case in `tests/renderer/admin-desktop.test.tsx`.

- [ ] **Step 1: Write the failing test.** The Supporters tab with a mocked `admin.supporters` showing one monthly ($3.00) and one yearly ($25.00) supporter displays "2" active and "$5.08" monthly.
- [ ] **Step 2: Run** it. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS. Then run the whole suite with `npm test`. Expected: all green.
- [ ] **Step 5: Commit** with message `feat(admin): Supporters tab`.

## Rollout (owner + after merge, not tasks)

1. Owner:
   - Create the Stripe account and the Prices ($3 monthly, $25 yearly).
   - Turn on the Customer Portal with cancel, plan switch and card update allowed.
   - Add a webhook endpoint `https://app.duelbinder.com/stripe/webhook` for the event types listed in Task 2.
   - Create the restricted key (permissions in Global Constraints) in the sandbox, then again in live mode.
2. Set the test-mode secrets and the price-id vars, and set `SUPPORTER_ENABLED = "on"`. Deploy the portal (from a fresh worktree: `npm ci`, then `npm run deploy`). Do a test-mode checkout on desktop, web and the phone web app. Cancel in the portal and check the badge stays until the period end.
3. Swap to the live keys and price ids, then tag the release.
