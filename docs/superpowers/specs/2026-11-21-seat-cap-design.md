# Seat cap with a waitlist

## Why

The Cloudflare bill grows with every account that syncs, scans and browses through the portal.
The owner wants to cap accounts at 100 for now and raise the cap later from the admin dashboard,
with no app release and no Worker deploy. People turned away join a waitlist, so when seats open
they go to whoever waited, in order, and the waitlist's length shows the demand.

## Goals

- At most `cap` accounts, counting open accounts plus outstanding invites. The cap starts at 100.
- A full sign-up shows "Duel Binder is full for now" and offers the waitlist.
- Raising the cap in admin invites the front of the waitlist straight away, one invite per new seat.
- An invite is a one-time link, good for 14 days. Opening it lets that person make an account past
  the cap.
- Admin can also invite one person now, even over the cap, and delete waitlist entries.
- Existing accounts are untouched: signing in to an account that already exists never checks the cap.

## Non-goals

- Limiting usage per account (quotas). Only account creation is gated.
- Letting friends' invites skip the cap.
- A cap on the desktop app itself, which works offline with no account.

## Anti-goals

- Gating any existing user's sign-in. That would lock out paying supporters and current testers.
- Invites that get past the cap by accident (an expired link that still works, a link reused for
  several accounts).
- A full sign-up that shows a bare error or a 500 with no way onto the waitlist.

## Approaches considered

1. **Invite link (picked).** A seat is reserved when the invite goes out, and the link lets its
   holder make one account. Fair, predictable cost, and works with Discord and email.
2. Email match: admit a sign-in whose email is on the admitted list. Breaks on Apple's hidden
   relay addresses and on Discord accounts tied to old addresses.
3. Reopen sign-ups and notify everyone. First come, first served. A big notify blast overshoots
   the cap, and people who never waited can take the seats.

## Design

### Data (server-51)

- `seat_settings`: a single row holding `cap` (default 100) and `updated_at`.
- `waitlist(id, email UNIQUE, created_at, invited_at)`. Joining twice keeps the first place.
- `seat_invites(token_hash PRIMARY KEY, email, waitlist_id NULL, created_at, expires_at, used_at,
  used_by)`. Only the token's sha256 is stored, as with `desktop_codes`.

**Seats used** = open accounts (`users.closed_at IS NULL`) + invites that are unused and unexpired.

### The gate

- `createAccount` (signIns.ts) is the one place accounts are made. Inside the same transaction it:
  - spends an invite if the sign-in carries one, then creates the account even past the cap;
  - else counts seats and throws `SeatsFull` when `used >= cap`.
- An invite is valid if it is unused, unexpired, and still the same row. It is marked used, with
  the new user id, in the same transaction, so it can never make two accounts.
- **Apple on iPhone can't carry the link** (sign-in is native and the portal has no web Apple
  flow). So an Apple sign-in is also admitted when its verified email equals the email on an
  outstanding invite. Hidden-relay Apple users would use Discord or email from the link instead.
- Email sign-up checks the cap at its `create` step too, so nobody is emailed a code and then
  refused; the check is skipped when the address already has an account or the flow carries an
  invite. The check at account creation still runs, because seats can fill in between.
- `createAccount` gains an optional invite token (and the Apple caller passes its verified email);
  callers translate `SeatsFull` into their own error shape. (My call.)
- The Apple email match requires Apple's verified email, applies only when no account exists for
  the sign-in, and spends the matched invite. (My call.)
- An invite link is bearer: whoever opens it gets the seat, whatever email they sign in with. A
  forwarded link gives the seat to a friend; that's accepted. (My call.)
- Undoing a merge reopens an account without the cap check: it was counted before. Any account
  close, merges included, frees a seat. (My call.)

### Carrying the invite through sign-in

- `GET /invite/<token>` on app.duelbinder.com:
  - **Valid token:** sets an HttpOnly `seat_invite` cookie (path `/`, lasting until the invite
    expires), then shows a "You're in" page with Continue with Discord and Continue with email.
  - **Used or expired token:** shows a page saying so, with the waitlist form.
- The web Discord callback and the web email form steps read the cookie and pass the raw token to
  `createAccount`.
- The desktop and phone apps don't need to carry it. The account is made on the web once, and
  their sign-ins then find it (`findAccount`).

### What a full sign-up sees

- **Web (Discord or email):** a "full for now" page at `/full`, with the waitlist email form.
- **Desktop and native phone Discord:** the callback error becomes `error=full`.
- **Native Apple:** JSON `{ error: 'full' }`.
- **Email in the app (JSON steps):** an `EmailAuthError` with code `full`.
- **App copy:** the desktop and phone apps show "Duel Binder is full for now. Join the waitlist"
  and a link to duelbinder.com/waitlist. Showing that copy needs an app release (the next
  ordinary one). Until then, older apps show their usual "sign-in failed". The gate itself is
  live as soon as the Worker deploys.

### Waitlist sign-up

- `POST /waitlist` is a form like `/beta`: an origin check, a honeypot, and an IP limit through
  `takeLimit` ('waitlist-ip', 5 a day).
- The form is on the site page duelbinder.com/waitlist and on the `/full` page.
- It answers with "You're on the list, we'll email you when a seat opens". The place in line isn't
  shown.
- While a seat is free and nobody is waiting (an entry whose invite lapsed counts as waiting), it
  adds no one and answers "Seats are open, sign up now" instead.
- Joining never sends an invite by itself; invites go out only from a fill. Emails on the waitlist
  aren't confirmed, so this keeps made-up addresses from holding seats.

### Invites

- **Sending:** an invite email ("A seat opened up") links to `/invite/<token>` and states the
  expiry date. The invite row is written, the email sent, and the row deleted if the send fails
  (a DO transaction can't span the send), so its seat goes to the next person.
- **The cookie:** `seat_invite` is SameSite=Lax so it survives the Discord redirect, and the email
  form steps read it at the step that creates the account. (My call.)
- **Refilling seats:** "fill" invites the earliest uninvited waitlist entries until
  `used == cap`. It runs:
  - when the admin saves a new cap;
  - when the admin presses "Fill open seats" in the Seats tab (opening the tab only reads);
  - after an account is closed.

  There is no cron, so an expired invite's seat refills on the next of those. That's my call; a
  daily cron can come later if it's ever needed.
- **Invite now (admin):** invites one waitlist entry immediately, even over the cap.
- **Resend (admin):** issues a new token with a fresh 14 days and voids the old one.

### Admin: a Seats tab

- On the web admin page (`adminPage.ts`) and the desktop native admin pages, next to Beta.
- **Top:** a cap number input with Save, and the counts used / invited / free / waiting.
- **Waitlist:** the entries in order, showing email, joined date and status, each with Invite now
  and Delete.
- **Invites:** the outstanding invites, showing email, sent and expires dates, each with Resend
  and Cancel. Cancel frees the seat, and the entry goes back to the front of the waitlist.
- **Routes:**
  - `GET /admin/seats`
  - `POST /admin/seats/cap`
  - `POST /admin/seats/invite`
  - `POST /admin/seats/resend`
  - `POST /admin/seats/cancel`
  - `POST /admin/seats/delete`
- The routes use the same admin checks as the Beta tab (`isAdmin`, `adminWriteAllowed`).

### Privacy

The privacy page adds waitlist emails: kept until the person is invited and signs up, or until
the admin deletes the entry.

## Left to the builder

- Copy wording and page styling, matching the existing `/beta` and email pages.
- Test layout, following tests/portal/beta.test.ts and sign-ins.test.ts.
- Whether `fill` sends emails one at a time or in a batch. Sequential is fine at this size.

## Release

1. Deploy the portal Worker; the gate and the admin tab are live from here.
2. Tag a release for the app copy and the desktop admin tab.

Today's ~7 accounts are far below 100, so nothing changes for anyone until the cap is reached.
