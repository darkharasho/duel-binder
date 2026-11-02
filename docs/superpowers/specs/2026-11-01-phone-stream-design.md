# Phone stream: the scan window's stream on a phone

This adds a **Stream mode** to the phone app (`src/phone`) for people who stream pack openings from their phone through Discord mobile's screen share. It works the way the desktop scan window does (see `2026-10-26-scan-window-design.md`): the camera fills the screen, each pull pops up with its name, price and owned count, and valuable pulls get a big moment.

A five-screen mockup was shown in chat on 2026-11-01 and the owner replied "generally looks pretty good", asking for upright and sideways. Their later answers override the mockup where the two differ (see "Reviewing and saving").

## Why

The owner wants streaming to work the same for "those that stream from their phones". On desktop, the camera is in its own window, and the list and controls stay private in the main window. A phone has one screen, and Discord shares all of it, so whatever Duel Binder shows is what viewers see. That is the design problem here.

The real setup, from the owner: Discord mobile, phone on a stand, back camera on the desk showing hands and cards, the owner's iPhone running the iOS app.

Success: the owner starts a Discord screen share, opens Stream mode, puts the phone on its stand in either direction, and opens packs without touching it. Viewers see each pull and hit as desktop viewers do. Afterwards, the owner opens the review drawer, fixes what needs fixing, and saves.

## Goals

- A Stream mode in the iOS app and the home-screen web version, both shipping together.
- The live back camera fills the screen, upright or sideways, following how the phone sits.
- The same pull pop-up, hit moment, timings and new/owned line as desktop.
- A hit price the owner can set, shared with the normal phone scanner's session.
- A small count of cards scanned and cards to check.
- A review drawer that can be pulled up mid-stream or left until the end, and that is the **only place to save cards to the collection**.
- The end-of-stream summary, with a way into the review drawer.

## Non-goals

- Sending video to Discord from the app, or any Discord integration. The owner starts the share in Discord.
- Audio.
- Pack totals or a running list on stream.
- Any recognition change, including rarity detection or tilting.
- Android as a store app. Android browsers use the web version as they do today.
- Front camera support. *Claude's call:* the owner uses the back camera, and the front camera is a much worse scanner.

## Anti-goals

- **Saving from anywhere but the review drawer.** There is no Add button on the stream screen or the summary, and leaving Stream mode saves nothing.
- **Losing pulls.** A crash, a call, the app going to the background or leaving Stream mode keeps every scanned card on the list.
- **The camera silently stopping on stream.** If the camera or scanning stops, the screen says so, and it recovers on its own when the app returns.
- **The phone sleeping mid-stream.**
- **A confident wrong card.** Unsure matches follow the desktop rules: best guesses are marked and are never hits, and a printing that isn't known shows no set or rarity.
- **Private information on screen.** Nothing beyond what the pop-ups show: no account details, and no collection value.
- **Controls sitting on the picture.** Between pulls, viewers see the camera, the corner marks and the small count.
- **A choppy camera.**

## The screens

All of these are visible to viewers while the share runs.

1. **Between pulls:** camera edge to edge, with faint corner marks always showing the area the scanner reads. Top left: "13 cards". Top right, only when some exist: an amber "2 to check". A small handle at the bottom edge opens the drawer.
2. **Pull:** the desktop bar, shown for 4 seconds. Upright it sits at the bottom, full width with margins. Sideways it sits bottom left and leaves the card visible.
3. **Hit:** the desktop moment and confetti, shown for 8 seconds, at the top of the screen in either direction.
4. **Controls:** tapping the screen shows Close stream and Pause for about 3 seconds, then they fade. *Claude's call:* the app must have a way out, and this keeps it off screen the rest of the time. Pausing shows only the camera.
5. **Review drawer:** see below.
6. **Stream over:** Close stream shows the desktop summary (count, value, hits) with a button that opens the review drawer. The list stays intact whatever is done here. *Claude's call:* no share button, despite the mockup. No share feature exists, and viewers already see this screen.

Before the stream, a start screen shows the hit price (dollar amount, editable, default $20, same `scan.hitPrice` setting as desktop) and a Start button, plus one line: turn on Do Not Disturb, because viewers would see notifications, and start the Discord share first. *Claude's call.* The same price can also be changed in phone Settings.

Entry point: a Stream button on `ScannerScreen`. *Claude's call.*

## The scanning area

Recognition reads a centred 3:4 upright crop of the frame (`centreCrop`), and that doesn't change. Full screen shows more than it reads: about the middle 42% of the width sideways on a 16:9 frame, and all but about 12% at each of the top and bottom upright. The owner approved faint corner marks around the crop, always on screen and seen by viewers ("yeah corner marks are fine"). The marks must match the crop exactly in both directions, and they stay above the video but below the pop-ups.

## Reviewing and saving

The owner: "the review drawer should still be the only place to save them to your collection." The mockup's Add button on the summary is therefore removed.

- The drawer is the existing `ReviewSheet`, so its row editing, Clear and Add work as they do today.
- In Stream mode it opens at about 60% height upright, and as a side panel of about 45% width sideways, so the camera stays visible. Scanning keeps running while it's open, and new pulls still appear.
- *Claude's call:* it opens showing only cards to check, with an "All" toggle. The Add button stays in its footer and acts on the whole list, as it does today, with its count saying so. Viewers see whatever is open, so the toggle keeps the default view short.
- Fixing a card announces nothing.

## What a stream counts

*Claude's call, after the builder check:* the list is persistent and Add empties it, so the stream can't count from the list alone.

- Each stream keeps its own small saved record of its pulls, used only for the on-screen count and the summary. It survives a crash or restart and ends when the owner closes the stream.
- Unsaved cards left from earlier scanning stay on the list and in the drawer, but aren't counted in the stream's numbers or summary.
- Saving mid-stream therefore doesn't drop the count or empty the summary. Removing a card or changing its printing or quantity on the list updates the record, so the summary agrees with the list. "To check" comes from the list, so it falls as cards are fixed or saved.
- The record is not a second way to save: nothing reaches the collection except the drawer's Add.

## Constraints and existing pieces

- `PullOverlay`, `overlay.ts`, `useOverlay`, `Confetti`, `FoundBurst`, `SummaryScreen`, `summary.ts`, `owned.ts`, `ScanHub`, `session.ts` and `ReviewSheet` are reused. Stream mode must not fork the pull or hit rules. `pullOf` and `pushPull` stay the single source.
- `PullOverlay` sizes itself with `vw` for a wide window. It needs to stay legible on a phone in both directions; how is the builder's call.
- `PhoneCamera` currently sits inside a padded layout with the chips below it, and the session lives in `ScanHub` with saved scans surviving restarts. Stream mode changes the layout only. There is only ever one camera opening.
- `ios/App/App/Info.plist` allows portrait only, and the app has no orientation or keep-awake code today. Only Stream mode rotates; the rest of the app stays upright. This needs a native change and an App Store update.
- The web version has no orientation lock on iOS, so it follows the device through CSS and resize handling. The wake lock depends on browser support. Where it's refused, the start screen says to set Auto-Lock to Never.
- Cross-tree imports: `src/phone` already imports from `@/features/scan`; the overlay pieces under `features/scan/window` are importable the same way. Anything Electron-only there stays out of the phone bundle.
- Phone tests follow the existing vitest setup, at most 2 workers.

## Must prove on a real iPhone first

These decide whether the design works, and can't be settled from the code:

1. Discord's iOS screen share keeps running while Duel Binder has the back camera open in the foreground, and viewers see the video.
2. Going to Discord to start the share and returning brings the camera back, in both the iOS app and the home-screen web version.
3. Scanning plus screen sharing stays smooth for 30 minutes without overheating or dropped scans.
4. Scan accuracy holds sideways and at stand distance.

Do these with a small throwaway build before the full work. *Claude's call on the bars:*

- If 1 or 2 fails on both versions, stop and bring it back to the owner.
- If only the web version fails, carry on with the iOS app and tell the owner the web version needs separate work.
- Check 3 passes with no crash, camera stop or visibly choppy video across 30 minutes.
- Check 4 uses at least 50 real cards at stand distance in each direction. It passes with no more wrong cards than the normal phone scanner on the same cards. If it fails, bring it back to the owner rather than changing recognition.

## Decisions left to the builder

- How Stream mode is routed inside `PhoneShell`, and how it's styled within the app's look.
- The orientation and keep-awake mechanism on iOS, whether a Capacitor plugin or a small native change.
- Exact sizes and animation of the count, handle and controls.
- How the drawer's stream layout is expressed in `ReviewSheet` without duplicating it.
- Battery warnings, if any.
