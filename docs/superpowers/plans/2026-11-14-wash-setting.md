# Background Colour Setting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A synced "Background" setting (Random / Locked + Randomize / Colourless) that controls the art wash on desktop, web and phone.

**Architecture:** One JSON column `users.prefs` in the portal Durable Object, read and written by RPCs `prefs:get` and `prefs:set`. A shared validator in `src/shared/prefs.ts` is used by both the Worker and the clients. On each device a hook, `useWashPref`, keeps a localStorage copy and syncs with the portal when signed in. `ArtWash` runs the page's wash through `applyWashPref` before it paints.

**Tech Stack:** Electron, React 19, TypeScript, TanStack Query, Vitest, Cloudflare Worker (Durable Object SQLite).

**Spec:** `docs/superpowers/specs/2026-11-14-wash-setting-design.md`

## Global Constraints

- Modes are exactly `'random' | 'locked' | 'colourless'`. The default is `'random'`.
- Locked holds colours only. The page's seed (blob pattern) still applies.
- A single setting covers every game.
- The server step is named `server-45`. It adds `users.prefs TEXT` (nullable; null means defaults).
- localStorage key: `prefs:v1`.
- The prefs query refetches on window focus and every 5 minutes (`300_000` ms).
- Tests: `npx vitest run --maxWorkers=2 <files>`. Typecheck with `npm run typecheck:web` and `npm run typecheck:phone`, run separately.
- UI copy: the setting label is "Background". The options are "Random", "Locked" and "Colourless". The button is "Randomize".

## Review Focus

- A malformed or oversized `prefs:set` payload (wrong mode, NaN in colours, 10 000 fams) → 400, and the stored value stays unchanged. Owned by Task 2.
- Corrupt localStorage (`prefs:v1` = `"{"`) → defaults, no crash at startup. Owned by Task 4.
- Signed out, or portal down → the setting still changes the background locally, and no error shows. Owned by Task 4.
- Locked chosen before any roll (no `locked` colours yet) → the first switch to Locked rolls once and saves those colours. Owned by Task 6.
- The scan page (`enabled=false`) stays wash-free in every mode. Owned by Task 5.

---

### Task 1: Shared prefs type and validator

**Files:**
- Create: `src/shared/prefs.ts`
- Test: `tests/shared/prefs.test.ts`

**Interfaces:**
- Produces:
  - `type WashMode = 'random' | 'locked' | 'colourless'`
  - `interface WashColours { fams: { lab: [number, number, number]; share: number }[]; dark: [number, number, number]; vivid: number }`. This is structurally the renderer's `Families` without `greyArt`.
  - `interface Prefs { wash: { mode: WashMode; locked?: WashColours } }`
  - `const DEFAULT_PREFS: Prefs` = `{ wash: { mode: 'random' } }`
  - `parsePrefs(raw: unknown): Prefs`. It never throws. Anything invalid becomes the defaults, field by field. An invalid `locked` is dropped and the mode is kept.
  - `validPrefsPatch(raw: unknown): Partial<Prefs> | null`. It is strict, for the Worker: null for any invalid input. `fams` must have 1–8 entries. Every number must be finite.

- [ ] **Step 1: Write failing tests** in `tests/shared/prefs.test.ts`:
  - `parsePrefs(undefined)`, `parsePrefs('x')` and `parsePrefs({ wash: { mode: 'neon' } })` all equal `DEFAULT_PREFS`.
  - A valid locked value round-trips.
  - `{ wash: { mode: 'locked', locked: { fams: [] , dark: [0,0,0], vivid: 0 } } }` gives `{ wash: { mode: 'locked' } }`.
  - `validPrefsPatch({ wash: { mode: 'colourless' } })` is non-null.
  - `validPrefsPatch` returns null for each of these: a bad mode, `NaN` in `lab`, 9 fams, a non-object, and an unknown top-level key.
- [ ] **Step 2: Run them.** They fail because the module is missing.
- [ ] **Step 3: Implement** `src/shared/prefs.ts`.
- [ ] **Step 4: Run the tests.** They pass.
- [ ] **Step 5: Commit** `feat(prefs): shared prefs type and validator`.

### Task 2: Worker storage and RPCs

**Files:**
- Modify: `workers/portal/src/migrate.ts` (append a `server-45` step to `SERVER_STEPS`, after `rollupStep()`)
- Create: `workers/portal/src/prefs.ts`
- Modify: `workers/portal/src/rpc.ts` (HANDLERS, next to `friends:wishlistVisible`, around line 267)
- Modify: `src/shared/portal.ts` (add `'prefs:get'` and `'prefs:set'` to `PORTAL_CHANNELS`)
- Test: `tests/portal/prefs.test.ts` (copy the `rpc()` helper pattern from `tests/portal/wishlist.test.ts:76`)

**Interfaces:**
- Consumes: `parsePrefs`, `validPrefsPatch` and `Prefs` from Task 1.
- Produces: `getPrefs(db, userId): Prefs` and `setPrefs(db, userId, patch: unknown): Prefs`. `setPrefs` merges the patch over the current value and stores it. On an invalid patch it throws `CollectionError` (a 400). The RPC `prefs:get` returns `Prefs`. The RPC `prefs:set(patch)` returns the merged `Prefs`.

- [ ] **Step 1: Write failing tests:**
  - a new user's `prefs:get` returns `{ wash: { mode: 'random' } }`;
  - `prefs:set({ wash: { mode: 'colourless' } })` returns 200, and a later `prefs:get` shows it;
  - setting a locked value, then `{ wash: { mode: 'random' } }`, gives mode random, and `locked` survives only if the patch's `wash` included it (`wash` is replaced as a whole object, which is documented in `prefs.ts`);
  - a bad patch returns 400 and leaves the stored value unchanged;
  - two users don't see each other's prefs.
- [ ] **Step 2: Run them.** They fail.
- [ ] **Step 3: Implement** the step, `prefs.ts` and the handlers.
- [ ] **Step 4: Run the tests.** Run `npx vitest run --maxWorkers=2 tests/portal/prefs.test.ts tests/portal/migrate*.test.ts`. Expect a pass.
- [ ] **Step 5: Commit** `feat(portal): synced prefs column and RPCs`.

### Task 3: Client plumbing for the RPCs

**Files:**
- Modify:
  - `src/shared/ipc.ts`: add `prefs: { get(): Promise<Prefs>; set(patch: Partial<Prefs>): Promise<Prefs> }` to `Api`, and the two names to `INVOKE_CHANNELS`.
  - `src/main/ipc/handlers.ts`: passthroughs via `account.portal`, next to line 255.
  - `src/phone/api.ts`: `portal(...)` entries, next to line 289.
  - `src/renderer/src/web/httpApi.ts`: `call(...)` entries, next to line 219.
  - `src/renderer/src/lib/api.ts`: `queryKeys.prefs = ['prefs'] as const`.
  - `src/main/dev/fakeFriends.ts`: in-memory `prefs:get` and `prefs:set`, next to line 424.
  - `tests/renderer/mockApi.ts`: `prefs: { get: vi.fn(async () => DEFAULT_PREFS), set: vi.fn(async (p) => ({ ...DEFAULT_PREFS, ...p })) }`.

**Interfaces:**
- Produces: `api.prefs.get()` and `api.prefs.set(patch)` on every platform.

- [ ] **Step 1: Make the changes.**
- [ ] **Step 2: Run the checks:**
  - `npm run typecheck:web`, then `npm run typecheck:phone`: both clean. The `invokeChannelsMatchApi` check enforces the channel list.
  - `npx vitest run --maxWorkers=2 tests/renderer/http-api.test.ts`: passes. Update its channel loop if it enumerates `PORTAL_CHANNELS`.
- [ ] **Step 3: Commit** `feat(prefs): prefs RPCs on desktop, web and phone`.

### Task 4: `useWashPref` hook with local copy and sync

**Files:**
- Create: `src/renderer/src/lib/washPref.ts`
- Test: `tests/renderer/wash-pref.test.tsx`

**Interfaces:**
- Consumes:
  - `api.prefs`, `queryKeys.prefs` (Task 3);
  - `parsePrefs`, `Prefs`, `WashMode`, `WashColours` (Task 1);
  - `useFriendsReady()` from `src/renderer/src/lib/friends.ts`.
- Produces: `useWashPref(): { wash: Prefs['wash']; setWash(next: Prefs['wash']): void }`.
  - It reads `prefs:v1` from localStorage through `parsePrefs` on first render, so startup applies the setting with no wait.
  - When `ready`, it queries `api.prefs.get()` with `refetchOnWindowFocus: true`, `refetchInterval: 300_000` and `retry: false`. A result is written to localStorage and becomes the value.
  - `setWash` updates the local value and localStorage first. Then, if `ready`, it calls `api.prefs.set({ wash: next })`. A failed call is swallowed, and the local value stays.
  - Every `useWashPref` in the window sees a change straight away. Use a small module-level store with `useSyncExternalStore`, plus the query result.

- [ ] **Step 1: Write failing tests:**
  - defaults with empty storage;
  - corrupt `prefs:v1` gives defaults;
  - a stored value is used on first render;
  - signed out (`ready` false): `setWash` updates the value and storage and never calls `api.prefs.set`;
  - signed in: a portal value replaces the local one;
  - `setWash` calls `api.prefs.set({ wash })`;
  - a rejected `set` keeps the new local value and doesn't throw;
  - two hook instances agree after one calls `setWash`.
- [ ] **Step 2: Run them.** They fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them.** They pass.
- [ ] **Step 5: Commit** `feat(prefs): useWashPref with a local copy and portal sync`.

### Task 5: Apply the setting in ArtWash

**Files:**
- Modify: `src/renderer/src/lib/wash/sample.ts`: add `colourlessFamilies(game: GameId): Families`.
- Create: `src/renderer/src/lib/wash/applyPref.ts`
- Modify: `src/renderer/src/components/ArtWash.tsx`
- Test: `tests/renderer/wash-apply-pref.test.ts`, plus an addition to `tests/renderer/art-wash.test.tsx`

**Interfaces:**
- Consumes: `useWashPref` (Task 4), `gameFallback` (existing).
- Produces:
  - `colourlessFamilies(game)` takes the game's two colours with chroma × 0.3, shares 0.65 and 0.35, `dark` = `[0.19, 0.004, h]`, `vivid` = the reduced chroma, and `greyArt: false`. These are starting values; tune them with the owner in Task 7.
  - `applyWashPref(wash: WashState | null, pref: Prefs['wash'], game: GameId): WashState`:
    - `random` returns `wash`, or the existing default when it is null (today's behaviour: `gameFallback`, seed 0, strength 1).
    - `locked` with `locked` set returns `{ families: { ...pref.locked, greyArt: false }, seed: wash?.seed ?? 0, strength: wash?.strength ?? 1 }`.
    - `locked` without `locked` behaves like `random`.
    - `colourless` returns `{ families: colourlessFamilies(game), seed: 0, strength: 0.4 }`.
  - `ArtWash` calls `useWashPref()` and paints `applyWashPref(wash, pref, game)`. `enabled=false` still returns null.

- [ ] **Step 1: Write failing tests** for each branch of `applyWashPref`:
  - locked keeps the page's seed;
  - colourless ignores the page;
  - locked without colours falls through to random.
  - `colourlessFamilies` chroma is ≤ 0.3 × the game colour's chroma.
  - In `art-wash.test.tsx`: with `prefs:v1` set to colourless, the rendered layers don't change when the `wash` prop changes; with `enabled={false}` it renders nothing.
- [ ] **Step 2: Run them.** They fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them.** Also run `tests/renderer/wash-*.test.ts*`. All pass.
- [ ] **Step 5: Commit** `feat(theme): the Background setting drives the wash`.

### Task 6: Settings UI on desktop, web and phone

**Files:**
- Create: `src/renderer/src/features/settings/WashSetting.tsx`
- Modify: `src/renderer/src/features/settings/SettingsPage.tsx`. Add a `Row label="Background"` in `DesktopSettings`' App section (around line 159). Add an App section holding only that row to `WebSettings` (around line 285).
- Modify: `src/phone/Settings.tsx`. Add a row in its style, in the group nearest to app or display settings.
- Test: `tests/renderer/wash-setting.test.tsx`

**Interfaces:**
- Consumes:
  - `useWashPref` (Task 4);
  - `rememberedCard(game, rand)` and `gameFallback(game, rand)` (existing, in `sample.ts`);
  - `useGame`.
- Produces: `WashSetting({ compact?: boolean })`, where `compact` is the phone layout.
  - It shows three options as a segmented control, using the app's existing chip/pill styles: "Random", "Locked" and "Colourless".
  - Choosing Locked with no saved colours rolls once and saves the result.
  - Under Locked, a swatch shows the locked colours: a small rounded box painted with `field(fit(colours,'dark'), {seed: 1})`, plus a "Randomize" button.
  - Randomize rolls with `rememberedCard(game, Math.random)?.families ?? gameFallback(game, Math.random)`, strips `greyArt`, and calls `setWash({ mode: 'locked', locked })`.

- [ ] **Step 1: Write failing tests:**
  - it renders the three options with the current one marked (`aria-pressed` or `aria-checked`);
  - clicking Colourless calls `setWash({ mode: 'colourless' })`. When the previous value held `locked` colours, they are kept in the saved value, so switching back restores them;
  - clicking Locked with no colours saves colours;
  - Randomize appears only under Locked and saves new colours.
- [ ] **Step 2: Run them.** They fail.
- [ ] **Step 3: Implement**, and wire the component into the three settings screens.
- [ ] **Step 4: Run the checks.** The tests pass. Also run `tests/renderer/settings*.test.tsx` and `tests/phone/*settings*.test.tsx` if they exist. Both typechecks are clean.
- [ ] **Step 5: Commit** `feat(settings): Background setting with Randomize`.

### Task 7: Check in the app

- [ ] **Step 1:** Run the full suite with `npx vitest run --maxWorkers=2`. Expect it to be green.
- [ ] **Step 2:** In the dev app (CDP driver `/tmp/wash-cdp`), screenshot Settings with each mode selected. Then screenshot Collection and Browse in each mode, and press Randomize 3 times, taking a screenshot after each press.
- [ ] **Step 3:** Show the owner. Tune `colourlessFamilies` and the colourless strength until they approve.
- [ ] **Step 4:** Commit the tuning, if there was any, as `fix(theme): colourless tuning`.
