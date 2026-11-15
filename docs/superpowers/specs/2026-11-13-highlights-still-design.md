# Highlights still: a PNG of a session's best pulls

## Intent

Owner's request: an option to save just a still PNG of a rip session's highlights, next to the Rip
Replay video. A still is quicker to post and to glance at than a video. Every hit should be
readable, with its name and price, rather than the video's end frame, which has small unlabelled
thumbnails.

## Goals

- A **Save image** button wherever **Make replay** is shown: the desktop scan page
  (`ScanPage.tsx`), Sessions (`SessionBlock.tsx`, owner only) and the phone Stream end screen
  (`StreamScreen.tsx`).
- The **Podium** layout, which the owner picked from two mockups:
  - The best pull in the centre, with its rarity pill, name and price.
  - The #2 and #3 pulls on either side, a little lower, each with name and price.
  - Pulls 4–8 in one row below, each with name and price.
  - "N hits · $total" centred near the bottom, clear of the row above.
  - The replay's session chip at the top left, its art-tinted backdrop and its
    "DUEL BINDER · RIP REPLAY" watermark with the logo.
- The same pulls as the replay (`ReplaySource.pulls`, `choosePulls`), so the two always agree.
- Saved the same way as the replay (`saveReplay`): a save dialog on desktop, the share sheet in the
  apps, share or download on the phone web.

## Non-goals

- No change to the replay video or GIF.
- No editing, captions or picking which pulls appear.
- No upload or sharing link: the file goes only to the device.

## Anti-goals

- Names or prices that are clipped or overlapping. Long names get an ellipsis inside their slot.
- A layout that looks broken with only 1–3 hits.

## Approaches

- **A: PNG as a third format on the replay toggle** (MP4 → GIF → PNG). This is the smallest
  change, but a picture is hidden behind a "Make replay" button.
- **B: a separate Save image button.** Easier to find, and it needs no progress bar. It adds a
  button to crowded rows. **The owner picked B.**
- Rejected: building the still as an HTML page and capturing it. That needs a new library, has
  font and cross-origin image problems, and wouldn't match the replay's look.

## Design

- **Drawing:** a new `drawHighlights(ctx, scene)` in the replay folder.
  - It reuses `draw.ts`'s backdrop, chip, watermark, rarity pill, card drawing and fonts. Export
    the helpers it needs rather than copying them.
  - It draws once onto a **1080×1350** canvas (4:5, as the replay; sharper than the 720×900
    video). Scale the context by 1.5 so the replay's helpers work in their 720×900 coordinates.
  - The canvas is exported with `toBlob('image/png')`.
- **Fewer pulls:**
  - 1 hit: the centre card only.
  - 2 hits: the centre card plus #2 on the left.
  - 3 hits: the full podium.
  - 4–8 hits: the podium plus the row below, centred.
  - The total line always shows.
- **Ordering:** pulls are stored cheapest first, so the best is last; the podium reads them from
  the end.
- **Making it:** the same steps as `makeReplay`: `loadReplayArt`, `loadReplayLogo` and
  `loadReplayFonts`, then draw and save. Then
  `saveReplay(blob, replayFileName('png'))`, which gives `rip-replay-YYYY-MM-DD.png`.
- **Button:**
  - **Save image** sits beside Make replay in `MakeReplay.tsx`, styled to match on the desktop
    and phone variants.
  - It is disabled when there are no pulls, like Make replay.
  - While it runs, the button shows "Saving…" with no percentage.
  - When it finishes, it shows the toast "Image saved".
- **Desktop save:**
  - In `src/main/ipc/handlers.ts`, allow `png` in the name check (`/^[\w.-]+\.(mp4|webm|gif|png)$/`).
  - In `src/main/index.ts`, label the save dialog filter "PNG image" for `.png`.

## Testing

- A unit test of the layout positions for 1, 2, 3, 5 and 8 pulls: nothing overlaps and everything
  stays inside the canvas. Drawing is checked by eye.
- A `MakeReplay` test: Save image calls its maker with the source, and shows the toast.
- The handler test accepts `.png` and still rejects other extensions.
- A manual check on desktop and on the phone Stream.

## Left to the builder

- Exact sizes and spacing, starting from the approved mockup: centre card about 200 px wide at
  720 px, sides about 130 px, row cards about 72 px.
- The text sizes in the row, as long as the names stay readable.
