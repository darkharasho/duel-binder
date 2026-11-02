# Background rarity read (replaces the tilt prompt)

Owner decisions, 2026-11-02. This replaces the prompt-and-hold behaviour from `2026-11-02-tilt-rarity-design.md` (shipped in v0.46.0, PR #161). The tilt model, its features and the worker's frame keeping stay; what changes is when they run and what they touch.

## Why

Scan speed comes first. The v0.46.0 tilt check holds a card for about 2 s (up to 4 s) and asks the user to tilt it, and on most foil-against-foil choices its guess is not much better than always picking the commoner rarity. The owner wants detection to stay as fast as before v0.46.0, and to get the benefit of the rarity work only when it costs nothing: if a counted card stays in view long enough, quietly improve its rarity.

The biggest win the owner sees is **Pokémon Normal against Reverse Holofoil**: every pack has two reverse holos, and today's scanner can't tell them apart. The tilt data is strongest on plain-against-foil pairs, including on frames with little motion. The owner expects natural hand wobble during a stream or scan session to give enough movement. On a fixed stand there will be little or no motion, and the read simply won't fire. That is acceptable because it is never worse than today.

## Goals

- Counting is exactly as fast as before v0.46.0: no prompt, no Skip, no hold, no timeout. A card counts the moment the loop counts it today.
- After a card counts with an unsure rarity, the scanner keeps reading that card from the frames the live loop already grabs. When it has a usable reading, it updates that counted row's rarity to its guess.
- The changed row gives a **small flash** so the user notices (owner's choice).
- The row stays flagged "Check rarity" / "Check version". A background guess never clears the flag.
- First target: Pokémon Normal against Reverse Holofoil. Yu-Gi-Oh! Common against a foil comes along, since it's the same plain-or-foil question.
- It works on every scanning surface: the main-window Scan page and in-page scanner, the desktop scan window (stream capture), the phone scanner, and Phone Stream mode once PR #153 merges.

## Non-goals

- No prompt or instruction to tilt, anywhere.
- No change to identification, to the order or timing of counting, or to the hit pop-up and ping.
- No new model training in this work. Refitting the existing model for the live loop's frame spacing is in scope if needed (see "Left to the builder").
- Changing copies already committed to the collection. Only unsaved session rows are updated.

## Anti-goals (a failure even if it technically works)

- Any added delay before a card counts, or a slower live loop, on any surface. Any per-frame cost added to the common path (a card with no unsure rarity) counts as a failure.
- Overwriting something the user chose. Once the user has touched a row's printing or rarity, the background read never changes it.
- Overwriting a rarity today's rules were sure of. Only rows still flagged unsure are eligible.
- Mixing frames from two physical cards into one reading. Two copies of the same card, one Normal and one Reverse, shown back to back is a normal pack-opening case.
- Putting accuracy numbers, corpus paths, clip names or any private training data in the repo, PR or commit messages.

## Behaviour

1. The loop counts a card as it did before v0.46.0. Its row goes into the session with today's rarity and flag.
2. The row is **eligible** for a background read if all of these hold:
   - its flag is the unsure one (`check-rarity`, or `pick-printing` for Pokémon, as today's tilt rule uses);
   - among its options, at least two finishes are ones the model knows, and at least one of those pairs is on the enabled list (below);
   - it isn't a `guess` row, no default rarity is set, and no overframe or full-art option is involved (as today).
3. While the same card stays in view, the worker keeps the straightened card from the frames the loop is already analysing, for frames whose art matches that card. No extra frames are grabbed and the loop's interval doesn't change.
4. When the kept frames give a usable reading, the scanner picks among that row's own options and updates the row's printing and rarity to the pick. The flag stays, and the row flashes once.
5. The read ends, keeps nothing more and changes nothing more when:
   - the card leaves view or a different card's art appears;
   - the loop counts a new row, even of the same card (a second copy starts a fresh read for the new row);
   - the user edits the row's printing or rarity, removes it, or commits the session;
   - a usable reading has been applied. One update per row; it doesn't flip back and forth.
6. If no usable reading arrives, nothing happens. The row stays exactly as counted.

### Enabled pairs

Only pairs where the held-out results clearly beat always guessing the commoner finish are enabled. At the start that means the plain-against-foil pairs: Pokémon Normal against Reverse Holofoil, and Yu-Gi-Oh! Common against each foil. Foil-against-foil pairs that are near a coin flip stay off. The list lives in code as a plain allowlist of pairs, with no accuracy figures beside it. The owner can widen it later.

### The flash

A short, single highlight on the row that changed, in every list that shows session rows (main-window scan list, phone review sheet and scanner screen, and the stream summary once Phone Stream merges). It should be noticeable but not alarming, and it shouldn't move the list or steal focus. It doesn't repeat.

### Removing the v0.46.0 prompt

Remove the hold and everything that only served it: the "Tilt the card" prompt and Skip on the in-page and phone scanners, the tilt status and Skip on the main-window Scan page, the `skipTilt` scan-window message, the hold and timeout in the loop, and the `tilt` status kind. Keep the model, features, frame keeping and pick logic that the background read reuses. Tests that pinned the prompt are replaced by tests of the new behaviour.

### Desktop scan window

The scan window counts by sending drafts to the main window's hub. A background update has to reach the hub's session row the same way: a new message from the scan window that names the counted draft and carries its new printing. Its delivery should be as reliable as draft delivery, so an update never lands on the wrong row.

## Calls made in writing this up (not the owner's; check these)

- **A fresh physical card resets the read.** The kept frames are dropped, and nothing more is applied to the old row, when any of these happen: the loop counts a new row; the card is absent for the loop's existing absence gap (`ABSENT_MS`); or the card's outline jumps far enough to mean a swap rather than a wobble. This is the guard against two copies of the same card shown back to back. If a same-art swap can't be told apart, the read gives nothing, not a mixed reading.
- **Cheaper frames are fine on an eligible card.** After an eligible row counts, the worker may try the held card's last outline first (as tilt frames do today), as long as a new card is still found as fast as before.
- **Row identity.** Each counted draft carries an id the loop knows, and the update names that id. The scan window uses its outbox id. An update is dropped if the row has been removed, committed or touched by the user, and also if its draft hasn't been delivered yet. The phone uses the same hub session, so the same checks apply there.
- **Phone Stream is a follow-up.** It gets the read in a small change after PR #153 merges, not in this work.
- **Bar for enabling a pair.** A pair is enabled only if, at the live loop's frame spacing and held out by card, it beats always guessing the commoner finish by at least 10 points. The figures stay in private notes. If no refit can be checked, ship only Pokémon Normal against Reverse Holofoil, and only if it meets the bar.
- **Switching set, game or default rarity mid-read** ends the read, the same as the card leaving.
- **The stream overlay doesn't change.** The pop-up viewers see in the scan window has already played when the card counted. Only the session row updates and flashes.
- **Reduced motion.** With reduced motion on, the flash is a brief colour change with no movement.

## Constraints

- Speed: per-card latency must not change. Report, in the PR, the measured per-frame cost the read adds on an eligible card (worker time per kept frame and per reading) on a desktop webcam. Add a phone measurement if a device is available, and say so if not.
- The live loop grabs a frame every 200 ms (`FRAME_MS`), not the 100 ms the tilt model was fit on. A 2 s window therefore holds at most about 10 frames.
- Vitest at most 2 workers. No heavy synthetic test data.
- No private data, clips or accuracy numbers in the repo or PR.

## Left to the builder

- How the read gets frames from the live loop: the worker has the straightened card only inside the worker, and today keeps it only for tilt frames.
- Whether the model needs refitting for the 200 ms spacing, or whether the reading window and minimum frame count change instead. Any refit is done privately with the existing fit tooling, and only coefficients ship.
- Whether the motion floor (`TILT_MIN_MOTION`) should be lower for plain-against-foil pairs. Lower it only if the held-out data supports it.
- Exactly how the flash looks, within "short, single, not alarming".
- How long the kept frames are kept per row, within the existing memory cap (`TILT_MAX_FRAMES`).
