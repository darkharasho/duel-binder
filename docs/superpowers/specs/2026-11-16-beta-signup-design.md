# Phone app beta signup — design

2026-11-16. Approved by the owner in conversation.

## Why

Friends of the owner's friends are asking for the phone app, and Google Play needs 12 testers
opted in to a closed test for 14 straight days before the app can go to production. Today testers
are added by hand from emails passed along in chat; there is no way to ask, and no disclaimer.

## Goals

- A public page where someone reads a beta disclaimer, agrees, and asks to join on Android or
  iPhone with the email their store account uses.
- An admin list where the owner sees requests, copies emails to paste into Play Console or
  TestFlight, marks people added or declined, and sees progress toward 12 Android testers.
- An email to the person when the owner marks them added.

## Non-goals

- Adding testers to Play or TestFlight automatically (the owner pastes emails by hand).
- Sign-in to ask; a desktop-app admin tab (web /admin only for now).

## Approaches

- **A. Request form + admin list, owner adds by hand (picked).** Owner controls who gets in,
  can count toward 12; costs a paste per batch.
- B. Self-serve links (Google Group + public TestFlight link) behind a disclaimer: no work per
  person, but anyone with the URL joins and nothing tracks the 12.
- C. A + App Store Connect API to invite iPhone testers automatically: Apple API work for a
  handful of iPhone users; Android still manual.

## Design

**Page `duelbinder.com/beta`** (site handler, site look):
- Disclaimer: test builds and may crash; the collection syncs to the account, but unsynced scans
  could be lost; feedback welcome; leave any time; the email is used only to invite you through
  Google or Apple.
- Fields: "I understand" checkbox (required), platform (Android / iPhone), store email (Google
  Play email or Apple ID), name, "Who sent you here?".
- No sign-in. Spam: hidden honeypot field, per-IP daily limit, one request per email + platform
  (a repeat is accepted quietly, not duplicated).
- After sending: "Thanks — you'll get an email when you're in."
- The site's Phone section links to it.

**Storage:** new `beta_requests` table (next server migration): email, platform, name,
referred_by, status (pending / added / declined), created_at, decided_at.

**Admin:** a Beta tab on web /admin: requests grouped by platform, pending first; Copy emails
(pending, comma-separated, per platform); Mark added / Decline per row; "Android added: N of 12".

**Email on Mark added:** through the existing email sender. Android: the Play opt-in link, read
from a Worker var `BETA_ANDROID_OPTIN_URL` (internal-test link now, closed-test link later). iPhone:
watch for Apple's TestFlight invite. No email on Decline.

## Owner steps outside code

- iPhone: create an external TestFlight group (Apple reviews the first build sent to it).
- Android: finish the App content forms so a closed test can start; only closed-test testers
  count toward 12.

## Left to the builder

Exact copy wording and layout within the site's style, the per-IP limit value, the table's
indexes, and email styling (reuse the sign-in email look).
