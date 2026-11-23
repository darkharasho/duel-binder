# App Store review: 0.114.0 rejection and resubmission (2026-11-22)

Notes for finishing the resubmission from the Mac.

## What happened

Apple rejected iOS 0.114.0 (build 206) under **Guideline 2.1, Information Needed**. It isn't a bug
report. Apple wants:

1. A screen recording **on a real device, starting from app launch**, that shows:
   - sign-up and sign-in
   - account deletion
   - user content with **report** and **block** (Guideline 1.2)
   - paid content
2. The app's purpose and audience.
3. Setup and login details for the reviewer.
4. The external services the app uses.
5. Any regional differences.
6. Proof of rights to the card art and other third-party content.

## What's already done

- **Report a user (Guideline 1.2):** built and shipped.
  - Friends shows a **Report** button on friends, requests (either way) and blocked users. Reporting
    takes a reason and an optional note, and an "Also block" box is ticked by default.
  - Each report is saved for the admin **Reports** tab (`/admin#reports`) and emailed to
    support@duelbinder.com.
  - A user can send 10 reports a day. The Terms now have an "Objectionable content" section.
  - Code: `workers/portal/src/reports.ts` and
    `src/renderer/src/features/friends/ReportDialog.tsx`.
  - Main is at 252b8d6d. Portal 7359c9ef is deployed (migration server-54).
- **Release:** v0.116.0 is tagged (c280643f). It's the first iOS build with Report, so record on
  **0.116.0 or later from TestFlight**.
- **Already in the app:** Block and Unblock, Sign out, and Settings → **Delete account**. The iOS
  app has no purchase buttons. The supporter tier is sold only on the web through Stripe, and the
  app shows only its status and Manage.

## Before recording (about 5 minutes)

1. Install **0.116.0** from TestFlight.
2. Make test account **B** on app.duelbinder.com with a spare email and an obvious username
   (`dbtest_friend`). Add a few cards to it.
3. Make reviewer account **R**, which is the login Apple gets. Friend R with B so the reviewer can
   try Report on B. **Don't use R in the video**, because blocking would break that friendship.
4. Have a third throwaway email ready for account **C**. The video creates C and deletes it.
5. Add Screen Recording to Control Center and turn on Do Not Disturb.

## Recording script (one take, about 3 minutes)

| # | On screen | Shows Apple |
|---|---|---|
| 1 | Start the recording from Control Center, go to the home screen, launch Duel Binder | Starts at launch |
| 2 | Pause about 2 s on the sign-in screen (Apple, Discord, email) | Ways to sign in |
| 3 | **Sign up** with email as C (switching to Mail is fine) and pick a username | Account creation |
| 4 | About 10 s on Scan, collection and Sets | What the app is |
| 5 | More → Settings → **Sign out**, then **sign in** as C again | Sign-in |
| 6 | More → **Friends**, search `dbtest_friend`, send a request | Where users interact |
| 7 | **Report** on that request: "Offensive name or picture", note "test report", **untick "Also block"**, Send report → "Thanks for reporting" → Done | Reporting |
| 8 | **Block** B and confirm; B shows under Blocked | Blocking |
| 9 | More → Settings, scroll past Support (no buy buttons on iOS) | No in-app purchases |
| 10 | **Delete account** and confirm; the app returns to sign-in | Account deletion |
| 11 | Stop the recording | |

If a step goes wrong, carry on. Apple wants to see the features, not a polished take. Step 7 unticks
"Also block" so Report and Block appear as two separate features.

## Draft review notes (paste into App Review Information → Notes)

> **Purpose and audience.** Duel Binder is a collection tracker for trading card players and
> collectors aged 13 and up: Yu-Gi-Oh!, Pokémon, Magic: The Gathering and One Piece. Users scan or
> add the cards they own, see set completion and estimated market value, build decks, and share
> binders with friends. It has no trading, marketplace or chat.
>
> **Login.** Reviewer account: email `<R's email>`, password `<R's password>` (Sign in with
> email). The account is already friends with `dbtest_friend`, so Report and Block can be tried from
> More → Friends.
>
> **User content.** Usernames, profile pictures, binder names and card photos are shared only with
> accepted friends. Users can Report (reason plus note, sent to support@duelbinder.com and acted on
> within 24 hours) and Block from Friends. The Terms ban objectionable content.
>
> **Account deletion.** Settings → Delete account removes the account, its synced collection, friends and
> sign-ins on every device.
>
> **Paid content.** The iOS app has no purchases. An optional supporter subscription is sold only
> on duelbinder.com. The app shows its status and has a Manage link but no buy buttons.
>
> **External services.**
> - Hosting and sync: Cloudflare.
> - Sign-in: Sign in with Apple and Discord.
> - Card data and images: YGOPRODeck, Yugipedia, TCGdex and Scryfall.
> - Prices: TCGplayer (TCGCSV) and eBay listings.
> - Supporter payments on the web: Stripe.
>
> **Regional differences.** None. The app and its features are the same in every region.
>
> **Card art.** See the next section before sending this part.

### Card art rights: decide the wording

Apple asked for "documentation of rights". Our position, from the Terms page:

- **Magic: The Gathering:** used under the Wizards of the Coast **Fan Content Policy**. The app shows
  the required notice in Settings. This is the strongest of the four.
- **Yu-Gi-Oh!, Pokémon and One Piece:** we hold **no licence**. The card images come from public
  card databases and are used only to identify cards the user owns. The app says it isn't
  affiliated with Konami, The Pokémon Company and Nintendo, or Bandai.

There's a risk here: Guideline 5.2 lets Apple reject the app for third-party art without written
permission. Options:

- (a) Say it plainly, as above, and point to the disclaimers.
- (b) If Apple pushes back, ship the iOS build with art turned off for the unlicensed games.

Writing to Konami, TPC or Bandai for permission is slow and rarely answered.

## On the Mac, with Claude

1. Record the video (above) and AirDrop it to the Mac.
2. Ask Claude to:
   - attach the video;
   - fill App Review Information (notes plus R's login);
   - reply to the rejection message and resubmit.
   
   The ASC helper and IDs are in the session notes: app 6827828796, reviewSubmission
   456a6ddf-1ed4-48d1-a5e2-cf26989a81ae. Nothing goes to App Store Connect without your OK.
3. Apple may say no again over the card art. If so, choose between (a) and (b) above.
