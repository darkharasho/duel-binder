# Rip Replay

A short, muted video of the best pulls of a scan or Stream night, saved to the device so the owner can post it in Discord.

## Why

The owner opens packs on Discord streams and scan nights. Afterwards they want something to share in the server that shows off the night's hits. Today the session ends on a summary screen with the list and "hit of the night", and there's nothing to post except a screenshot.

## What it is

- **Where (owner: Stream only on phone):** the session summary screen that ends phone Stream mode (`src/phone/stream/StreamScreen.tsx`), and the desktop scan window (`src/renderer/src/features/scan/window/SummaryScreen.tsx`, built from `sessionSummary` in `summary.ts`). That's phone (iOS app, Android app, phone web) and desktop (Electron).
- **Desktop placement (my call):** the scan window is the one captured for the stream and can't be clicked, so the button goes in the main window's scan page, next to the "Show summary" toggle (`ScanPage.tsx`). It builds from the same list the summary shows.
- **What counts as the night (my call):** desktop has no session end. The night is the current scan list, from when it was last cleared, and the header date is the date of the last pull. On phone Stream it's the stream's record (`record.ts`).
- **When:** only when the owner taps a **Make replay** button on that summary. It's never made on its own.
- **Output:** a video file saved to the device. The owner shares it themselves, with no posting from the app. On desktop it's a save dialog. On phone it's the system share/save sheet (Capacitor) or a download on phone web.
- **Length:** about 30 seconds at most. The owner said 30 seconds.
- **Sound:** none. Muted, because Discord autoplays muted.

## How pulls are chosen

**The top pulls by price, for all three games** (owner, 2026-11-05; replaced an earlier rarity-first plan, a hit-price threshold, and a fixed count).

- **What makes it:** every pull that is not a common or uncommon and isn't priced at pennies (owner). The pennies floor is $1.00, so anything under a dollar is left out (my call on the number). There's no fixed count: a quiet night gives a short replay.
- **At most 8** (owner). If more than 8 qualify, keep the 8 most expensive. They're shown cheapest first, building up to the most expensive, which is held longest.
- **Commons and uncommons never count** (owner). Excluded: Common and Uncommon in every game (Yu-Gi-Oh! Common; Pokémon Common/Uncommon; One Piece C/UC), plus Yu-Gi-Oh! Short Print and Super Short Print, which are commons in all but name (my call).
- **Pokémon needs the card's rarity looked up:** on a Pokémon `ScanRow`, `rarity` is the print version (Holo, Reverse Holo), so whether it's a Common or Uncommon has to come from the catalog's `pokemon_cards.rarity`. Pull selection looks it up and attaches it, on desktop and phone (Japanese/Chinese C/U equivalents included). The caption shows that card rarity too (e.g. "SPECIAL ILLUSTRATION RARE"), not the print version (my call).
- Unpriced cards and best guesses (`row.guess`) never count.
- **Tie-break:** the order pulled (my call).
- **Duplicates:** one entry per card, labelled "×2" etc. if pulled more than once (my call).
- **No qualifying pulls:** the button shows but is disabled with "No pulls to replay" (my call).
- The summary's own "hit of the night" (`sessionSummary`) stays as it is. The replay's best pull is normally the same card, since both go by price.

## The look: countdown (owner picked mockup B)

- **Shape:** 4:5 portrait, dark purple backdrop, matching the app.
- **Header chip:** the date of the night, the number of cards and the list value, e.g. "Nov 4 · 142 cards · $310". There's no pack count, because a scan session doesn't know it. The rank sits top right: "#3 of 6".
- **Each pull, in order from the lowest-ranked shown up to the best:** the card art slides up in with a holo sheen and holds while the caption shows the rarity in small gold capitals, the name, and the price. Then it slides off. About 3 s per pull (my call), with the best pull at 5–6 s.
- **Close:** a short end card with the best pull and a tally like "6 hits · $214" (from mockup C, my call, about 2 s).
- A small "DUEL BINDER · RIP REPLAY" mark along the bottom throughout.
- **Art:** the same art the summary already shows (the owner's own printing photo when `photoFor` gives one, else the catalog image). Art that fails to load drops that pull rather than showing a blank card (my call).

### Camera moment (optional, owner)

- A setting, off by default (my call): **Include camera moments**.
- When on, each pull opens on about 2 s of the real camera footage from the moment that card was scanned, then a white flash, then the art slides in as above.
- A pull with no saved footage just shows the art.
- This needs the camera during the session to keep a short rolling buffer (a few seconds) and, when a card is added that could make the replay, keep the clip around that moment. It covers the phone camera in Stream (not the regular phone scanner) and the webcam in the desktop scan window. Keep only what could qualify (not a common/uncommon, $1.00 or more), cap the total (e.g. 12 clips, cheapest dropped first), and keep it in memory or temp storage. Throw it away when the session's list is cleared.
- Recording the whole night is out: the files would be too big.
- The buffer must not slow scanning. The owner cares about scan speed ([scan-speed-priority]). Measure per-card latency with the setting on, and if it costs anything noticeable, it stays off by default and says so.

## Phasing (my call)

1. **Release 1:** the art-only countdown, MP4 + GIF, phone Stream and desktop.
2. **Release 2:** camera moments, once release 1 is out. This keeps the risky part (buffers on three camera paths, moving clips between windows, scan latency) from holding up the replay.

## File format

- MP4 (H.264) by default: sharp, small, and it autoplays inline in Discord. It must stay under 10 MB, Discord's free upload limit. Lower the bitrate or the resolution (e.g. 720×900) to fit.
- GIF as a second choice in a small menu next to the button (my call). It may need fewer frames or a smaller size to fit 10 MB.
- Rendering happens on the device. No server, and nothing uploaded.
- If a platform can't encode MP4 (e.g. a WebView without MP4 `MediaRecorder` support), fall back to WebM where Discord still plays it, or GIF. Say which in the save sheet.

## Goals

- One tap after a night gives a postable clip of the real hits.
- It looks good enough that people want to post it.
- It works the same on phone and desktop.

## Non-goals

- Posting to Discord from the app (webhooks, bots).
- Music or sound.
- Replays of Rip, the virtual pack opener, or of past sessions from history. Only the session on the summary screen right now.
- Editing the replay: no reordering, picking or trimming pulls in v1.
- Recording full sessions.
- Replays from the regular phone scanner. On phone it's Stream only (owner).

## Anti-goals (failure even if it "works")

- Slower scanning when the camera option is on.
- A file over 10 MB that Discord refuses.
- A replay padded out with commons/uncommons, or featuring wrong guesses.
- Blank or broken card frames in the video.

## Left to the builder

- How to render: canvas + `MediaRecorder`/WebCodecs, an encoder library, or Electron-side encoding. Pick per platform; it doesn't need to be the same everywhere.
- Exact timings, easing and frame rate (24–30 fps is fine).
- Where the camera buffer lives and how clips are cut.
- Test approach: pull selection and ordering are pure functions and need unit tests. The video itself needs a manual device check on iOS, Android and desktop.

## Reference

- Mockup B (the countdown) was rendered in-app during the design chat on 2026-11-05.
- Existing code: `src/phone/stream/record.ts` (what a stream pulled), `src/renderer/src/features/scan/window/summary.ts` (summary and hit rule), `src/renderer/src/features/rip/SessionSummary.tsx` (`rankedHits`, the Rip version of the same idea).
