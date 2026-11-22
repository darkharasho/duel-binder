#!/usr/bin/env bash
# Usage: native-check.sh <ios|android> <NAME+NUMBER>
# Exits 0 when the phone shell at HEAD (of the current directory's checkout) is the same as at the
# native release native/<platform>/<NAME+NUMBER>, so an over-the-air update made from HEAD reaches
# installs of that release. Exits 1 when the shell changed (native code, capacitor.config.ts or a
# Capacitor/Capgo plugin), 2 on bad usage; anything else (missing tag, a check that can't run) is
# also non-zero, which scripts/review-required.sh counts as "needs review".
#
# The comparison is scripts/live-update/fingerprint.ts, the same fingerprint ota-publish.sh checks
# before publishing an update and the portal checks before offering one. review-required.sh runs this
# script from the current checkout inside a temporary worktree of an older version, so both sides
# are compared as committed (HEAD's commit and the tag), never as this script's own checkout.
set -euo pipefail
platform="${1:-}" release="${2:-}"
case "$platform" in ios | android) ;; *) echo "Usage: native-check.sh <ios|android> <NAME+NUMBER>" >&2; exit 2 ;; esac
[[ "$release" =~ ^[0-9]+\.[0-9]+\.[0-9]+\+[0-9]+$ ]] || { echo "release must be NAME+NUMBER, not '$release'" >&2; exit 2; }
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
tag="native/$platform/$release"
git fetch -q origin "refs/tags/$tag:refs/tags/$tag" 2>/dev/null || git rev-parse -q --verify "refs/tags/$tag^{commit}" >/dev/null \
  || { echo "No tag $tag."; exit 3; }
head="$(git rev-parse HEAD)"
# Worktrees share objects and refs, so fingerprint.ts (which runs git in its own checkout) can read
# this checkout's HEAD commit by hash.
# tsx: this checkout's, else one on PATH (CI installs only it: no npm ci needed), else npx's.
tsx="$here/../node_modules/.bin/tsx"
[ -x "$tsx" ] || tsx="$(command -v tsx || true)"
fp() {
  if [ -n "$tsx" ]; then "$tsx" "$here/live-update/fingerprint.ts" "$platform" "$1"
  else npx --yes tsx "$here/live-update/fingerprint.ts" "$platform" "$1"; fi
}
now="$(fp "$head")"
then="$(fp "refs/tags/$tag")"
if [ "$now" = "$then" ]; then
  echo "The $platform shell at ${head:0:8} matches $tag ($now)."
  exit 0
fi
echo "The $platform shell changed since $tag ($then -> $now)."
exit 1
