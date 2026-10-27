# Scan window: the camera in its own window, with pulls shown on stream

This moves the desktop app's **Scan camera into its own window**. The owner streams pack openings ("rips") to Discord. While they open packs, Duel Binder watches the webcam and scans each card. The scan window shows the camera with an overlay naming each pull. The owner can maximize it or make it full screen, and shares it in Discord. The main Duel Binder window stays fully usable, and its Scan page becomes the list of everything scanned.

Mockups were shown and approved in chat on 2026-10-26 ("A with C's moment for hits"). They are described under "What the scan window shows" below. The owner then decided (2026-10-26) that the camera view itself becomes its own window: "i want the scan view as its own window i can maximize/fullscreen. the main duel binder window stays usable with the scan page still as the list of all scanned items."

## Why

The owner streams rips to Discord and wants Duel Binder scanning as they open packs. Today they would have to pick between streaming the webcam and scanning with it. On Linux, only one app can usually open a webcam, and the owner shares their camera straight from Discord, with no OBS.

The owner's answer is for Duel Binder to own the webcam in a window of its own, which they share in Discord instead of their camera. That window must not depend on what the main window is doing: the owner should be able to look at their collection mid-rip without the stream going dark.

Success: the owner opens the scan window, makes it full screen and shares it in Discord. They rip packs on camera. Viewers see each card's name and price pop up as it's recognized, and a big moment for valuable pulls. Meanwhile the main window's Scan page fills its list as it does today, ready to add to the collection afterwards, and the owner can browse anywhere in the main window without interrupting the scan.

## Goals

- A separate **scan window** that owns the camera and recognition, can be resized, maximized or made full screen, and is meant to be shared in Discord (or any screen-share or OBS window capture).
- For each recognized pull, an overlay that **fades in, then out**: a lower-third bar with the card's name, set code, rarity and price.
- **Hits**: a pull priced at or above a price the owner sets gets a bigger moment instead of the bar.
- **The main window stays usable** while scanning: every page works, and leaving the Scan page doesn't stop or pause the scan.
- The main window's **Scan page is the list** of scanned cards, working as it does today (fix printing, rarity, count, add to collection), filling live as the scan window counts pulls.

## Non-goals

- Pack or box totals, pack counting, or a running list on stream. These were mockup option B, which the owner didn't choose.
- Sending video to Discord directly, a virtual camera, or OBS integration. The owner shares the window themselves.
- Audio on stream.
- Changes to recognition itself: speed, accuracy, or telling rarities apart (see `2026-10-26-scan-design.md` and the parked Scan follow-ups).
- Web app. Like Scan, this is desktop only.

## Anti-goals (failure even if it technically works)

- **Viewers see app UI** in the scan window: menus, buttons, dialogs, the list or the owner's edits. While sharing, the window shows only the camera and the overlays.
- **Viewers see a wrong card announced with confidence.** A match Scan isn't sure about must not get the full bar with a price (see "Unsure matches").
- **A choppy or laggy camera on stream.** The video must be as smooth as Scan's preview is today. Overlays must never slow it down or block it.
- **Something on stream the owner can't see.** The owner won't watch the shared window closely while ripping, so anything it shows must agree with what the Scan page list shows.
- **Losing pulls.** A pull counted while the owner is on another page, or while the Scan page is being edited, must still land in the list.

## The two windows

**Main window, Scan page:** the list of scanned cards, as today, plus the scan controls: open the scan window (or bring it to the front if it's open), pick the camera, pause and resume, and the hit price. The camera preview moves out of this page into the scan window. When the scan window is closed, the page says so and offers the button to open it. Camera problems (none found, permission denied) are explained here in full, as today. *Controls living here, not in the scan window, is Claude's call:* it keeps app UI off the stream.

**Scan window:** opens from the Scan page. Its title is plain and easy to find in Discord's window picker, e.g. "Duel Binder — Scan". It can be resized, moved to another monitor, maximized, or made full screen (F11, and a double-click or similar, builder's call). The camera fills it edge to edge. It has no visible controls while sharing; if the builder wants a way to exit full screen or close it with the mouse, that control appears only on hover and fades away, never on a frame viewers would see for long. Its size and position are remembered across openings.

**Lifetime:** the camera is open, and scanning runs, exactly while the scan window is open. Closing the scan window stops the camera and scanning; the list stays. Navigating the main window, including leaving the Scan page, changes nothing in the scan window. Closing the main window or quitting the app closes the scan window. *Claude's call:* the camera never runs without the window, so there's no hidden camera use.

## What the scan window shows

Three states, as in the approved mockup:

1. **Waiting:** only the camera, edge to edge, with no overlay. This is what viewers see most of the time.
2. **Normal pull:** while Scan is reading a card, the green outline Scan draws today is drawn on the video. When the card is recognized and counted, a **lower-third bar** fades in along the bottom. It shows a small thumbnail of the matched art, the card name, the set code, the rarity and the price (large, on the right). After about **4 seconds** it fades out.
3. **Hit:** if the pull's price is at or above the **hit price**, it shows a centered moment instead of the bar: the rarity in small spaced capitals, the card name large, and the price, over a soft gold glow behind the card. It lasts about **8 seconds**, then fades back to the plain camera.

**Several pulls close together:** a new pull replaces the overlay on screen straight away. A hit is never cut short by a normal pull; the normal pull's bar waits until the hit has faded, then shows. *Claude's call.*

**Unsure matches:** if Scan flags a row **Pick printing** (it knows the card but not the printing), the bar shows only the card name, with no set code, rarity or price, and it is never a hit. *Claude's call.* **Check rarity** rows (the printing is known but the rarity is a guess) show normally, with the rarity Scan picked and that rarity's price. The owner accepted that the window shows the rarity the scan picked even when it's unsure. "Couldn't recognize this card" shows nothing in the scan window; it appears on the list as today.

**Paused:** only the camera, with no outline and no overlays.

**No camera:** a plain dark screen with a short message, e.g. "Camera not available". The full explanation is on the Scan page.

## What counts as a pull

The scan window announces exactly the events that add to, or raise the count of, a row on the Scan page's list. These are Scan's existing "one count per showing" rules: a card counts once when recognized, and a new showing of the same card raises that row's count.

*Claude's call:* if a showing counts on the list, it's announced, including a second copy of the same card. In a rip, two copies of one card in a pack are real pulls.

Holding a hit up again to show it off is also a new showing under Scan's existing rules, so it counts twice. That's an existing behavior, not something this change introduces; the owner fixes the count on the list with −. Changing it is out of scope.

**No re-announcing:** fixing a row on the list afterwards (picking a printing, changing rarity, changing the count) shows nothing in the scan window. *Claude's call.*

**One source of truth:** the overlay is built from the same data as the list row it adds or raises, so the two can't disagree. The scan window never looks a card up separately for display.

## Price and the hit line

- **Price:** the printing's market price in the app's local catalog, the same price the collection value uses. Each rarity of a set code is its own printing with its own price, so the rarity Scan picked has a price of its own. It is shown as the app shows prices elsewhere. Pulls with no known price show no price and are never hits.
- **Hit price:** one setting, a dollar amount, default **$20** (*Claude's call*), set on the Scan page next to the other scan controls. It is remembered across restarts using the app's existing settings mechanism (add the smallest one needed if there isn't one). A pull priced at or above it is a hit.

## Look

- Dark, translucent bar with light text and the price in green, as in the mockup. The hit moment uses gold for the rarity line and glow. The style should match the app's existing palette.
- Sized for being watched in a Discord stream: text stays legible when a 1080p window is downscaled to 720p, and overlays scale with the window size.
- Overlays never cover the middle of the frame for normal pulls, so viewers can see the card. Only the hit moment's text sits at the top, above where the card is usually held.
- Fades are short (about a quarter second in and out). No sliding or bouncing.

## Decisions left to the builder

- **Where the session list lives** so that counts from the scan window reach it whatever page the main window is on, and the owner's edits on the Scan page and new counts never overwrite each other. Today the list is in the Scan page's localStorage (`scan.session.v1`) and only exists while the page is mounted; it needs one owner that both windows talk to (for example the main process, or the main window's app shell, with IPC between the windows). The list must survive restarts as it does today.
- How controls (camera choice, pause, hit price) reach the scan window, and how camera status gets back to the Scan page.
- Whether the scan window is a second BrowserWindow loading the same renderer bundle at its own route, or something else, as long as it's sandboxed and context-isolated like the main window.
- Exact fade timings and sizes within the ranges above.
- Whether the video is mirrored. It should read like the owner's normal Discord camera, so text on cards isn't backwards for viewers.

## Constraints and existing pieces

- Scan lives in `src/renderer/src/features/scan/`. `useCamera.ts` opens the webcam and remembers the chosen camera, `useScanLoop.ts` runs recognition and decides when a card counts (with `tracker.ts` and the `vision/` worker), `resolve.ts` turns a match into a draft row, and `session.ts` holds the list. `ScanPage.tsx` currently owns all of these. The camera, the loop and the worker move to the scan window; the list and its editing stay on the Scan page.
- The main window is created in `src/main/index.ts` (sandboxed, context-isolated preload). The scan window follows the same security settings.
- There is only ever **one** camera opening, in the scan window.
- Recognition, the counting rules, the list's behavior, adding to the collection and offline recognition are unchanged.
- The camera's resolution and the remembered camera choice carry over from today's Scan.

## Change (2026-10-26, after the first try): the scan window is added, not a replacement

The owner, on trying it: "i want this as a net new so without the open scan window it should show the old scanner."

- **Scan window closed:** the Scan page is today's scanner, unchanged — camera preview, outline, status, camera picker, set picker, New scans as, the list — plus the `Open scan window` button and the hit price. It scans in the page as before, and stops when the owner leaves the page.
- **Scan window open:** the Scan page is the list plus controls, as described above, and the camera is in the scan window.
- **One camera at a time:** opening the scan window stops the page's camera first; closing it brings the page's preview back if the owner is on Scan. The camera choice is shared.
