# Org Move and Workspaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the repo to the `duelbinder` GitHub org without breaking auto-updates, CI or the
portal, and put the repo's packages under one npm workspace install.

**Architecture:** Transfer the repo (GitHub keeps redirects from the old path), prove that
already-installed apps still resolve updates through the redirect, then repoint every hard-coded
`darkharasho/duel-binder` URL at the new path in one PR. Separately, make the root `package.json`
an npm workspace root over the two Workers that already have their own `package.json`. Nothing
under `src/` moves.

**Tech Stack:** GitHub (org, transfer, Actions), electron-builder / electron-updater, npm
workspaces, Cloudflare Workers (wrangler, @cloudflare/vitest-plugin).

**Spec:** `docs/superpowers/specs/2026-10-29-multi-game-pokemon-design.md` (Step 1).

## Global Constraints

- Org: `duelbinder` (display name "Duel Binder"). New repo path: `duelbinder/duel-binder`.
- Keep the macOS appId `com.darkharasho.yugiohcollectiontracker` (`electron-builder.yml:1`,
  `setAppUserModelId` in `src/main/index.ts:204`). Keep the iOS appId `com.darkharasho.duelbinder`
  (`capacitor.config.ts:9`, `APPLE_AUDIENCE` in `workers/portal/src/apple.ts:8`). The `darkharasho`
  in these ids is not a repo path and must not change.
- No behavior change, same tests passing, same build outputs. The nightly catalog job
  (`.github/workflows/catalog.yml`) and the release (`.github/workflows/release.yml`) keep working.
- Nothing is published as a separate package. The phone, desktop and Worker keep sharing code from
  source (`@shared`, `src/main/repo`, and so on).
- The repo transfer and the org creation are outward-facing: the owner does them, or confirms each
  one before an agent runs it.
- Vitest runs with `--maxWorkers=2` (already in the root `test` script and the portal's).

**Workspace scope (builder's call, recorded here):** the workspace root covers `workers/portal` and
`workers/ebay-prices` only. The desktop, phone and web builds stay in the root package. They share
one `node_modules`, the `@`/`@shared` aliases, and the `src/main` code the phone and portal import
(`src/main/ipc/dataHandlers`, `src/main/repo`). Moving them into separate packages would rewrite
every config and import for no gain for the multi-game work, which is the reason this step exists.

## Review Focus

- **An old installed build checks for updates after the transfer:** it still finds releases (Task 2
  proves this before anything is repointed).
- **The marketing site's download button** (`workers/portal/src/site/releases.ts` calls
  `api.github.com/repos/<owner>/duel-binder/releases/latest`) still resolves after the transfer
  and after the repoint. Task 3's test pins the new URL; Task 2 checks the API redirect.
- **`npm ci` on a clean checkout** (CI, release, catalog, iOS jobs) installs the Workers too, and
  `npm ci --ignore-scripts` in `ios.yml` still builds. Task 4 verifies this on a fresh clone.
- **The portal's Miniflare tests** run under the workspace with their pinned vitest 4.1.12, not the
  root's vitest 5. Task 4 runs them.
- **The portal deploy script** (`npm --prefix ../.. run build:web …` in
  `workers/portal/package.json`) still works from `workers/portal`. Task 4 runs it as a dry run.

---

### Task 1: Create the org and transfer the repo (owner, manual)

**Files:** none.

- [ ] **Step 1: Record what the repo has today**, to compare after the transfer:

```bash
gh secret list -R darkharasho/duel-binder
gh variable list -R darkharasho/duel-binder
gh api repos/darkharasho/duel-binder/actions/runners --jq .total_count
gh api repos/darkharasho/duel-binder/environments --jq '.environments[].name'
```

Expected today: secrets `APPLE_TEAM_ID`, `APP_STORE_CONNECT_ISSUER_ID`, `APP_STORE_CONNECT_KEY`,
`APP_STORE_CONNECT_KEY_ID`, `PORTAL_ADMIN_TOKEN`; runners `0`. `release.yml` also reads `CSC_LINK`,
`CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`; note whether they live in an
environment or are unset (unset means macOS builds unsigned, as today).

- [ ] **Step 2: Owner creates the org** at https://github.com/account/organizations/new: name
  `duelbinder`, display name "Duel Binder", free plan. (Orgs can't be created through the API.)

- [ ] **Step 3: Owner confirms, then transfer:**

```bash
gh api -X POST repos/darkharasho/duel-binder/transfer -f new_owner=duelbinder
```

Expected: JSON whose `full_name` is `duelbinder/duel-binder`.

- [ ] **Step 4: Point the local clone at the new path and re-run Step 1** against
  `duelbinder/duel-binder`:

```bash
git remote set-url origin https://github.com/duelbinder/duel-binder.git && git fetch
```

Expected: the same secrets, variables and environments as Step 1. Anything missing gets set again
by the owner before Task 3 merges.

- [ ] **Step 5: Owner re-checks third-party connections:** in Cloudflare (Workers & Pages → each
  Worker → Settings → Builds) any GitHub connection is re-authorized for the `duelbinder` org; in
  App Store Connect / Xcode Cloud nothing points at the repo (the iOS build runs in `ios.yml`).

### Task 2: Prove old installs still update through the redirect

**Files:** none (a verification record goes in the Task 3 PR description).

- [ ] **Step 1: Check the URLs electron-updater's GitHub provider uses for a public repo**
  still resolve from the old path:

```bash
curl -sIL https://github.com/darkharasho/duel-binder/releases.atom | grep -iE '^(HTTP|location)'
curl -sIL https://github.com/darkharasho/duel-binder/releases/download/v0.20.0/latest-linux.yml | grep -iE '^(HTTP|location)'
curl -sIL https://api.github.com/repos/darkharasho/duel-binder/releases/latest | grep -iE '^(HTTP|location)'
```

Expected: each ends in `HTTP/2 200` after a `301` to `duelbinder/duel-binder`.

- [ ] **Step 2: Run an installed 0.20.0 build** (the Linux AppImage from the v0.20.0 release) with
  logging, and trigger its update check:

```bash
ELECTRON_ENABLE_LOGGING=1 ./Duel-Binder-0.20.0.AppImage 2>&1 | grep -iE 'update|latest'
```

Expected: the log shows it fetched the release feed and found no newer version, with no 404. A
Windows install checks the same way if one is at hand.

- [ ] **Step 3: If any step 404s, stop.** Don't repoint or release; report to the owner. The fallback
  is to keep `publish.owner: darkharasho` with a placeholder repo there that mirrors releases, which
  is a new decision for the owner.

### Task 3: Repoint every repo URL at the new org

**Files:**
- Modify: `electron-builder.yml:52,59` (`maintainer` stays `darkharasho`: it's the Linux package
  maintainer name, not a path; `publish.owner` becomes `duelbinder`)
- Modify: `package.json:7` (`homepage`)
- Modify: `src/main/updater.ts:4`, `src/main/dev/directSources.ts:21`,
  `src/main/konami/packArt.ts:20`, `src/main/konami/logos.ts:12`, `src/main/tcgplayer/catalog.ts:12`,
  `src/main/yugipedia/client.ts:2`, `scripts/catalog/build.ts:124`,
  `scripts/scan/rarity-corpus/common.mjs:16`
- Modify: `workers/portal/src/site/releases.ts:4,6`, `workers/portal/src/site/page.ts:6`,
  `workers/portal/src/images.ts:63`
- Test: `tests/portal/site-releases.test.ts`, `tests/portal/site-page.test.ts`,
  `tests/portal/images.test.ts`, `tests/portal/fixtures/release.ts`,
  `tests/main/yugipedia-client.test.ts`

**Interfaces:** none new. The exported constants (`RELEASES_URL`, `RELEASES_FALLBACK`, `REPO_URL`)
keep their names.

- [ ] **Step 1: Update the tests first** so they expect `https://github.com/duelbinder/duel-binder`
  and `https://api.github.com/repos/duelbinder/duel-binder/releases/latest` everywhere they now say
  `darkharasho/duel-binder`.

- [ ] **Step 2: Run them to see them fail**

Run: `npm test -- tests/portal/site-releases.test.ts tests/portal/site-page.test.ts tests/portal/images.test.ts tests/main/yugipedia-client.test.ts`
Expected: FAIL on the old URLs.

- [ ] **Step 3: Change every file listed above** from `darkharasho/duel-binder` to
  `duelbinder/duel-binder`. Leave the appIds (Global Constraints) and `author: darkharasho` alone.

- [ ] **Step 4: Check nothing is left**

Run: `git grep -n 'darkharasho/duel-binder' -- ':!docs'`
Expected: no output. (`docs/` keeps historical links; GitHub redirects them.)

- [ ] **Step 5: Run the full checks**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 6: Commit and open a PR** with Task 2's verification output in its description.

```bash
git checkout -b chore/org-move
git commit -am "chore: point repo links at the duelbinder org"
```

- [ ] **Step 7: After merge, deploy the portal** (`npm run deploy` in `workers/portal`) so the
  site's download button calls the new API path. The portal deploy is one-way; it changes only URLs
  here.

### Task 4: npm workspaces over the two Workers

**Files:**
- Modify: `package.json` (add `"workspaces": ["workers/portal", "workers/ebay-prices"]`, and a
  `test:portal` script: `npm test -w workers/portal`, and `typecheck:portal`:
  `npm run typecheck -w workers/portal`)
- Delete: `workers/portal/package-lock.json` (the root lockfile now covers it)
- Modify: `package-lock.json` (regenerated by `npm install`)
- Modify: `.github/workflows/ci.yml` (add `npm run typecheck:portal` and `npm run test:portal`
  after `npm test`)
- Modify: `workers/portal/README.md` and `workers/ebay-prices/README.md` if they say to run
  `npm install` inside the Worker directory

- [ ] **Step 1: Record the baseline** from the current tree:

```bash
(cd workers/portal && npm ci && npm test && npm run typecheck)
npm run build:web && npm run build:phone && ls workers/portal/site/app | sort > /tmp/site-before.txt
```

Expected: portal tests and typecheck PASS.

- [ ] **Step 2: Add the workspaces and scripts, delete the portal lockfile, and run `npm install`**
  at the root. Then check that the portal kept its own vitest:

Run: `npm ls vitest -w workers/portal`
Expected: `vitest@4.1.12` under `duel-binder-portal`. If npm hoisted vitest 5 into the portal
instead, pin it there with an `overrides` entry and re-run.

- [ ] **Step 3: Run everything from the root**

Run: `npm run typecheck && npm test && npm run typecheck:portal && npm run test:portal`
Expected: PASS, with the same test counts as Step 1 and the root suite's last run.

- [ ] **Step 4: Check builds and the deploy path are unchanged**

```bash
npm run build:web && npm run build:phone && ls workers/portal/site/app | sort | diff /tmp/site-before.txt -
(cd workers/portal && npx wrangler deploy --dry-run --outdir /tmp/portal-dry)
```

Expected: no diff, and the dry run bundles without errors.

- [ ] **Step 5: Check a clean install the way CI and iOS do it**

```bash
git clone . /tmp/db-clean && cd /tmp/db-clean && npm ci && npm run test:portal
cd /tmp/db-clean && rm -rf node_modules && npm ci --ignore-scripts && npx cross-env NODE_ENV=production vite build --config vite.phone.config.ts --mode ios
```

Expected: both installs succeed, the portal tests pass, and `out/ios-web` is built. (This is
`build:ios` without `cap sync ios`, which needs macOS; `ios.yml` runs the full script on PR CI.)

- [ ] **Step 6: Update the READMEs**, then commit and open a PR

```bash
git checkout -b chore/workspaces
git add package.json package-lock.json .github/workflows/ci.yml workers
git commit -m "chore: npm workspaces for the portal and eBay Workers; CI runs portal tests"
```

Expected on the PR: CI green, including the new portal steps.
