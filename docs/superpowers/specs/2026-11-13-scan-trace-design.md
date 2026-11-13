# Scan trace (admin) — design

2026-11-13. Short design: a small change.

## Why

During a live Magic session on 2026-11-13 some cards wouldn't read, and the only way to see the
installed app's scanner was screenshots. The miss (Void Extrapolator, FRA 70) turned out to be an
artwork missing from the nightly Magic fingerprint file, which no screenshot shows. The owner wants
a way, as admin, for Claude to read how each frame is identified in the real installed app, for
deeper analysis and fixing misses. Owner's machine first; friends' machines later.

## Goals

- An admin-only switch that makes the installed (packaged) desktop app write a trace of every scan
  frame to disk, readable live from a terminal (`tail -f`).
- Each trace line says what the scanner saw and decided, enough to tell why a card didn't read.
- Sampled JPEG frames alongside, so a miss can be replayed through the photo tests or added to the
  corpus.
- A small script that summarises a trace session into miss reasons.

## Non-goals

- No network: nothing leaves the machine. Friends' traces (zip + upload via the portal) come later.
- No remote control of the app (no debug port, no local server). That was approach B; revisit only
  if traces fall short.
- Phone and web builds are left out.

## Anti-goals

- Slowing a normal (non-trace) scan. With the switch off, the loop does no extra work.
- Filling the disk: frames and sessions are capped.

## Approaches

- **A. Trace files (picked).** Admin switch → JSONL + sampled JPEGs under userData; Claude tails
  and summarises. Small, reuses the dev-only debug-frame path, saved frames feed the corpus.
- B. Live localhost connection with a token, streaming events and taking commands (re-run a frame
  with a set picked). Can experiment, but 2–3× the work and a door into the app to guard.
- C. Chromium debug port for admins. Dropped: lets anything local drive the signed-in app and
  still doesn't expose the scan reasoning.

Owner picked A ("A, go for it"), my machine first, friends later.

## Design

- **Switch.** A "Scan trace" toggle in the scan Options panel, shown only when `user.admin`.
  Stored in settings (local, not synced). Off by default; off again when the user isn't admin.
- **Where.** `userData/scan-trace/<ISO start>/` per scan page session (a new folder each time the
  loop starts with trace on): `trace.jsonl` and `NNNN.jpg`. Main keeps the newest 20 sessions and
  at most 400 frames per session (every 3rd frame with a card found, plus every frame whose outcome
  changed). The existing dev-build `scan-debug` keeps working as is.
- **One line per analysed frame** (frames with no card found are written once per stretch, not
  each frame), with:
  - `t`, `seq`, `game`, `setKey`, picked sets, language filter, finish lock, camera label and size
  - `found`, `quad`, `artVia`, `artBack`
  - `art`: top 5 `[imageId, distance]` with the card name and set codes of each, looked up in
    main; plus whether that game's fingerprint file is complete (count and etag, from
    `fingerprintStatus`)
  - `lookups`: every call the resolver made through `ctx.lookups` (method, args, short result),
    recorded by wrapping `api.scan` for that frame; plus the language and local-name reads it asked
    for and what they returned
  - `outcome` (`none`/`far`/`unsure`/`recognized`), and for recognized: card, printing, rarity,
    finish, guess; `counted` (tracker draft made)
  - timings (pixels, vision, ocr, lookup) and `frame` (the JPEG name, when one was kept)
- **IPC.** `scan:trace(line, jpeg?)` in main, refused unless the switch is on and the signed-in
  account is admin. Main appends the line and writes the JPEG. `scan:traceDir` returns the current
  folder so the Options panel can show "Tracing to …" with an Open folder button.
- **Summary script.** `scripts/scan/trace-summary.ts <dir>` (run with `npx tsx`): counts outcomes,
  groups misses into reasons — no outline; outline but best art far (with "art not in fingerprint
  file" when the expected printing's image id isn't in the local `fingerprints-<game>.bin`);
  close art but unsure (margin); recognized wrong is left to a human — and lists the frames for
  each.
- **Tests.** Unit tests for the trace line builder (pure function from raw signals + outcome +
  recorded lookups), the lookups recorder, main's caps and admin refusal, and the summary's
  grouping.

## Left to the builder

- Exact field names and how short lookup results are trimmed (keep a line under ~8 KB).
- Where in `useScanLoop.ts` the recorder wraps `api.scan` (one wrapper per frame).
- Whether "frames with no card" stretches carry a count.
