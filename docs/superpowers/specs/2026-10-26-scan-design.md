# Scan: add cards by holding them up to a webcam

A new **Scan** page in the desktop app. You hold cards up to a webcam one at a time. The app recognizes each card and its exact printing, then keeps a running list that you review and add to your collection in one go.

A mockup was shown and approved in chat on 2026-10-26. Its layout is described under "The screen" below.

## Why

The owner adds cards from a physical stack. Today that means finding each card in the app by hand: Add Card, or the bulk mode on a set's checklist. Scan should make the common case hands-free. You hold a card up, it's on the list, you hold up the next one. Fixing a mistake should take one click.

Success: the owner works through a stack from one set by holding cards up. Most cards land on the list with the right printing without touching the keyboard. Rarities that can't be told from the camera are quick to set, before scanning or on the list.

## Goals

- Recognize a card held up to the webcam and add it to a session list. Target: within about a second of holding it still.
- Identify the **exact printing** (set code + rarity), not just the card name. The owner said: "read the set code, let me fix it if wrong".
- A **set picker** so the app doesn't need to read the code when you're scanning one set.
- A review list where any row can be fixed quickly, then **Add all to collection**.
- **Everything runs locally.** No cloud recognition service; the owner said this explicitly.

## Non-goals

- Web app. Scan is desktop only and the web build has no Scan page.
- Scanning several cards in one frame, binder pages, or video files. It's one card at a time, held up (the owner's answer).
- Condition grading. The collection doesn't track condition.
- Telling foil from non-foil on camera. Rarity comes from the set code's known rarities, the "New scans as" default, or the user.

## Anti-goals (failure even if it technically works)

- **Wrong cards entering the collection silently.** Nothing is added until the user presses Add. An unsure match is flagged on the list; a card that can't be recognized isn't listed.
- **Counting one showing several times.** Holding a card still must not add it repeatedly.
- **Needing the internet to scan.** Recognition must work offline once the one-time data below is on the computer.

## How recognition works (decided with the owner)

Each card held up goes through these steps in order, all on the computer:

1. **Find the card** in the frame (its outline) and straighten it.
2. **Read the set code** (e.g. `LOB-EN005`) by reading text. Search the **whole card**, not one fixed spot. Normal cards print it under the art on the right, while Pendulum, Link and overframe cards put it elsewhere, often bottom right. A code that matches a known printing gives the card and set exactly.
   - **With a set picked**, codes are expected to start with that set's prefix. *Claude's call:* the code is still read as a check whenever it's legible. If it names a different set, it wins: the card is listed from that set and flagged so the user notices. If the code isn't legible, the art match within the set needs a stricter score than an "Any set" match. A card from another set that only resembles one in the picked set must come out unsure, not recognized.
3. **If the code can't be read, match the artwork** against card art fingerprints. With a set picked, compare only against that set's cards. Art matching also picks the right **alternate artwork** (`image_id`).
4. **If still unsure, read the card name** and match it against card names.
5. **If all fail**, show "Couldn't recognize this card" in the status bar and add nothing.

**Rarity:**
- If the identified code exists in only one rarity, use it.
- Otherwise use the "New scans as" default if it's set and that rarity exists for the code.
- Otherwise pick the lowest rarity tier the code came in (there's no pull-rate data; rank by the `RARITY_COLORS` order) and flag the row **Check rarity**.
- **Art variants** (Extended Art, overframe and coloured-foil printings): the catalog stores these as separate printings whose rarity reads "Ultra Rare (Extended Art)" etc. (`card_printings.variant`). *Claude's call:* they appear as their own entries in the rarity dropdown, and they count as "more than one rarity" for the code, so the row is flagged **Check rarity**. Art matching doesn't try to tell variants apart this round; only `card_images` art is fingerprinted.

**One count per showing:** a card counts once when it's recognized. The next card counts after the current one has left the frame (or the frame has clearly changed). Holding up a second copy of the same card is a new showing and raises that row's count.

## The screen

A new **Scan** nav item, between Browse and Friends. Desktop only.

- **Header:** the title, then a **Set** picker (any English set, or "Any set", which reads codes) and a **Camera** picker (the available webcams; remember the choice).
- **Left, camera:** a live preview.
  - A green outline around the detected card.
  - A status bar along the bottom: "Dark Magician LOB-EN005 · added, lower it to scan the next card", "Couldn't recognize this card", or "Hold a card up".
  - Below the preview, **New scans as**: a rarity default (Auto, or a rarity), used while scanning, e.g. a stack of commons. Shown as a dropdown or segmented control (builder's call); Auto is the default.
  - A **Pause** button.
  - A short confirmation sound or flash when a card is added (builder's call which; must be subtle).
- **Right, session list** ("This session", with total cards and entries):
  - Newest at the top and briefly highlighted.
  - Each row: thumbnail (the matched art), name, set code, **rarity dropdown** (every rarity that printing came in; the owner asked for a dropdown because there can be many), −/count/+, and remove (✕).
  - Rows needing attention show a yellow left edge and a reason: **Check rarity**, or **Pick printing** when only the card is known (from art or name match without a code). Pick printing opens a printing chooser for that card.
  - Rows for the same printing + art merge, and their counts add.
- **Footer:** **Clear** (asks to confirm) and **Add N cards to collection**. Adding uses the existing add behavior, so adding a printing you already own increases its quantity. On success the list empties and a confirmation shows how many were added.
- No camera, or camera permission denied: a plain message in place of the preview explaining what's wrong. The list still works.

## Decisions made by Claude (flagged to the owner in chat, not objected to)

- **Art fingerprints are built by the nightly catalog job and downloaded once.** The desktop only caches images of cards you've viewed, so it can't fingerprint every card locally without downloading all the art. The nightly job (`.github/workflows/catalog.yml`, `scripts/catalog/`) already builds the full catalog. It would also produce a compact fingerprint file of every card image (a few MB), served from the portal (R2). The desktop downloads it on first use of Scan and refreshes it when the catalog refreshes. Signed-in or not doesn't matter. Recognition itself never uses the network.
  - Without the file (first use offline), Scan still works by **set code** and **name** reading. The art step is skipped and the page says so.
  - *Refresh:* the desktop checks the portal for a newer file after its own daily catalog sync, and replaces it if the version changed. Cards the local catalog has but the file doesn't (brand-new cards) can still be found by code or name; no special message.
- **The session list survives an app restart** (stored locally, cleared by Add or Clear).
- **Every printing language** (owner's decision, 2026-10-26, replacing the earlier English-only call). Set codes are read with any region (`LOB-EN005`, `SR14-DE023`, `SDK-JP001`, regionless old Japanese codes), and the set picker lists every language's sets with its language tag. Card names are read in English only; a non-English card that has no legible code is found by its art, then you pick the printing (language included).

## Constraints and existing pieces

- Electron desktop app, React + TypeScript renderer, Tailwind + shadcn/ui, SQLite via better-sqlite3 in the main process. The dark "catalogue" palette is in `src/renderer/src/index.css`.
- Pages: `Page` union in `src/renderer/src/components/AppShell.tsx`. Desktop-only features are hidden on web via `isWeb()` (`src/renderer/src/lib/platform.ts`).
- Renderer reaches the backend only through `window.api` (`src/shared/ipc.ts`). Adding entries: `api.collection.add(AddEntryInput)`.
- Printings: `card_printings` (set code, rarity, language, `variant`); art: `card_images` (`image_id`). Bulk add work (`docs/superpowers/specs/2026-10-25-bulk-add-design.md`) already has per-set, per-rarity data and `RARITY_COLORS` that can be reused.
- Webcam access is via the renderer's `getUserMedia`; Electron needs the media permission granted for the app's own origin only.
- Text reading and image work must run locally and must not block the UI (a worker or the main process). Library choice is the builder's, e.g. an OCR engine running in WebAssembly and OpenCV-style card detection. Model/language data files ship with the app or come with the one-time download; no runtime calls to third-party services.
- The nightly job reuses desktop catalog code and must not import `electron` from anything it reaches (`src/main/sync/catalog.ts` note).
- Tests: vitest with `--maxWorkers=2`. Recognition should be testable against still images of cards (fixtures), without a camera.
- **Fixtures (owner's decision):** build and tune against **generated** test images for now: catalog card images warped onto backgrounds, with blur, glare, tilt and poor lighting. The owner will take real webcam photos later, and the thresholds get retuned on them then. Keep the thresholds in one place so that retune is easy.

## Left to the builder

- Card detection, OCR and art-fingerprint techniques and libraries, as long as they run locally, meet the ~1 second target on a normal laptop, and don't freeze the UI.
- Fingerprint file format, size, versioning and where it's stored on disk.
- Confidence thresholds for "recognized" vs "unsure" vs "not recognized", tuned against fixture photos.
- Exactly how "card left the frame" is detected.
- How the camera's resolution/focus is configured.
- Delivery order. Suggested: set-code reading with a picked set → session list and Add → art fingerprints and the nightly job → name fallback → polish.

## Later (separate project)

**Rip**: a tab that simulates opening packs from a set with realistic odds, without adding to the collection. It gets its own design after Scan.
