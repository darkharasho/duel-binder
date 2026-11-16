# Supporter tier — design

**Why:** cover hosting plus a bit extra before opening to many more users. This is the second monetization step; affiliate buy links (v0.99.0) were the first. People who like the app can pay without anything being taken away from people who don't.

**Price:** $3/month or $25/year (owner, 2026-11-16).

## Goals

- A signed-in user can become a supporter from the web, the desktop app (opens the browser) and the home-screen web app.
- Supporter status follows the account to every device and to friends' views.
- Supporters can cancel, change card or switch monthly/yearly without emailing the owner.
- The owner can see supporter count and monthly income in /admin.

## Non-goals

- Locking features. Every feature stays free; nothing gets worse for non-supporters.
- New usage caps to make "higher limits" worth paying for. Today's caps (50 binders per game, 4,000 history points, 1,000 cards per session) don't bind anyone, so raising them for supporters means nothing. Revisit only if the Costs tab shows a real per-user cost driver (most likely stored photos).
- One-off tips. Possible later as a Stripe Payment Link, not in this build.
- In-app purchases in the App Store / Play builds (see Approaches).

## Anti-goals

- Nagging: no pop-ups, no countdowns, no "you're on the free plan" banners. One quiet entry in Settings, one line on the site, and a thank-you after paying.
- Making the app read as a paid product in a way that undercuts the "free app" footing the art sources rest on (PokiPair art use was justified on that basis).

## Approaches

**A. Stripe Checkout + webhook to the portal (recommended).**
The Worker creates a Checkout Session for the signed-in user; Stripe calls a webhook on the Worker, which records status on the account. Stripe's hosted Customer Portal handles cancel/card/plan changes.
- Fees: 2.9% + 30¢ → about 13% of a $3 month, 4% of a $25 year. (Stripe Tax, if turned on, adds 0.5%.)
- Work: one table, three routes, a webhook signature check (WebCrypto HMAC, no SDK needed), a Settings section, a badge.
- The account is the source of truth, so status works on every platform for free.

**B. Ko-fi / Patreon / GitHub Sponsors memberships.**
Almost no code to take money, but status has to be matched back to an account by email from their webhooks, which fails whenever the payment email differs from the sign-in (Discord and Apple sign-ins often have no email we can match). Patreon takes 8–12%. Rejected: the matching problem is the whole feature.

**C. Store in-app purchases (Apple/Google, e.g. via RevenueCat).**
Required to sell *inside* the iOS/Android apps outside the US. 15–30% commission, separate products per store, receipt validation, and it still needs A for web/desktop. Rejected for v1. The store apps show supporter status (bought on the web) but no buy button. Since 2025 US storefronts allow linking to outside purchases; adding a US-only "Support on duelbinder.com" link to the store apps is a small follow-up once A is live.

## Design

### Data (portal, new migration)

`supporters` table, one row per user who has ever started checkout:

| column | meaning |
|---|---|
| `user_id` PK → users | |
| `stripe_customer_id` | unique |
| `stripe_subscription_id` | nullable |
| `plan` | `'month' \| 'year'` |
| `status` | Stripe subscription status (`active`, `past_due`, `canceled`, …) |
| `current_period_end` | ISO; status stays "supporter" until this passes even after cancel |
| `since` | first time they became active, kept across lapses (for "Supporter since 2026") |
| `show_on_site` | 0/1, opt-in for the thank-you list; default 0 |
| `updated_at` | |

A user is a **supporter** when `status IN ('active','trialing','past_due') OR current_period_end > now`. `past_due` keeps the badge during Stripe's retry window.

Deleting an account deletes the row and cancels the subscription through the Stripe API first (account delete route already exists; it gets one more step).

### Routes (portal Worker)

- `POST /api/supporter/checkout {plan}` — signed in. Creates or reuses the Stripe customer, creates a Checkout Session (`mode=subscription`, `client_reference_id=user_id`, price id from wrangler vars `STRIPE_PRICE_MONTH` / `STRIPE_PRICE_YEAR`), returns `{url}`. Success URL: `https://app.duelbinder.com/supporter/thanks`; cancel URL: back to Settings.
- `POST /api/supporter/portal` — signed in, existing customer. Returns a Customer Portal session `{url}`.
- `POST /stripe/webhook` — unauthenticated, verified with `STRIPE_WEBHOOK_SECRET` (Stripe-Signature, HMAC-SHA256, 5-minute tolerance). Handles `checkout.session.completed`, `customer.subscription.created|updated|deleted`, `invoice.payment_failed`. Upserts the row from the subscription object (idempotent: always write the latest state Stripe sends, ordered by the event's subscription data, not by arrival).
- `/api/me` gains `supporter: { since, until, plan } | null`.
- Friend-facing payloads (friends list, friend page, binder share) gain `supporter: boolean` for the badge.
- `GET /admin/supporters` — admin: count active, monthly-equivalent income (year/12), list with since/plan; added as a tab next to Costs.

Secrets: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (wrangler secrets; also stored in 1Password Private like the admin token). Stripe test mode keys first, live keys at launch.

### App (shared renderer: desktop, web, phone web app)

- **Settings → Support Duel Binder** section:
  - Not a supporter: two lines on what it pays for ("Hosting, card art and price lookups cost money every month. Supporting keeps the app free for everyone.") and two buttons, *$3 / month* and *$25 / year*. Desktop opens the Checkout URL in the browser; web navigates.
  - Supporter: "Thank you — supporter since <month year>", *Manage* (Customer Portal), and the *Show my name on the thanks page* toggle.
  - Store builds (Capacitor iOS/Android): the supporter state and *Manage* for existing supporters; no buy buttons (see Approach C).
  - Signed out: "Sign in to support" (status needs an account).
- **Badge:** a small heart beside the username on the user's own account menu, friends list, friend page and shared binders. No badge anywhere for non-supporters, so absence isn't a mark.
- **Thanks page:** `app.duelbinder.com/supporter/thanks` after checkout says thank you and refreshes `/api/me` (the webhook may land a second or two after the redirect, so it polls `/api/me` for up to ~10 s and then says "it may take a minute to show").
- **Site:** a one-line "Support Duel Binder" link in the duelbinder.com footer to a short page explaining the tier and listing opted-in supporters' display names.

### Perks (all cosmetic or thanks; nothing locked)

1. Heart badge on profile, friends list and shared binders.
2. Name on the site's thanks list (opt-in).
3. Early access: supporters can switch on unreleased features the owner marks as "preview" (reuses the existing tester gating, so no new flag system). Owner decides per feature.

Not a perk: hiding affiliate buy links. That should be a setting for everyone if anyone wants it, not something you pay to remove.

### Legal pages

- Terms: a "Supporter subscriptions" section — what it is, price, renews until cancelled, cancel any time in Settings → Manage, no features withheld, refunds at the owner's discretion via Stripe.
- Privacy: Stripe processes payment; the portal stores customer/subscription ids, plan, status and dates, never card details.

### Analytics

Usage events `supporter:checkout` (button pressed) and `supporter:manage`, sent in their own batch like the buy events.

## Testing

- Webhook: signature valid/invalid/stale; each event type moves the row to the right state; replayed and out-of-order events end in the same state.
- Status rule: active, past_due, canceled-but-period-not-over, canceled-and-over.
- Routes: signed-out 401; checkout reuses an existing customer; portal 404 without a customer.
- Account delete cancels the subscription (Stripe client mocked).
- Renderer: Settings section in each state, store-build variant has no buy buttons, badge appears only for supporters.
- Manual: full test-mode checkout → webhook → badge on desktop, web and phone web app; cancel in the Customer Portal → badge stays until period end.

## Rollout

1. Owner: create the Stripe account and the two Prices, and turn on the Customer Portal (allow cancel, change plan, update card).
2. Ship on test-mode keys behind the `SUPPORTER_ENABLED` var, check end to end, then swap to live keys and turn the var on.
3. Deploy the portal before tagging the release, as usual.

## Owner decisions this design assumes (my calls — change any)

1. **Stripe** as the processor (Approach A).
2. **No buy button in the App Store / Play builds** for v1; US-only link later.
3. **Perks** = badge, thanks list, early access; **no limit increases**.
4. **Stripe Tax off** at launch. US sales tax on digital subscriptions varies by state; at this volume most states' thresholds aren't reached, but that's the owner's call (or their accountant's), not code.

## Left to the builder

Exact copy, heart icon choice, where the admin tab sits, migration number, and how the Stripe REST calls are wrapped (plain `fetch` with form encoding is enough; no SDK).
