#!/usr/bin/env bash
# Publishes a phone web bundle as a live (over-the-air) update to the native releases that are
# already on phones, without a store build. Used by .github/workflows/ota.yml, once per bundle
# target, after building the web bundle at this commit with package.json's version set to the
# update's version (publish.ts reads it from there).
#
# Usage: ota-publish.sh <ios|android-apk|android-play> <web-dir> <NAME+NUMBER>... [--dry-run]
#
#   <NAME+NUMBER>  Native releases the update is for (tags native/<platform>/<NAME+NUMBER>, pushed by
#                  ios.yml / android.yml once a build reached TestFlight / Play; see
#                  native-release-targets.sh). NUMBER is the build number the app reports.
#
# Native check: the shell's fingerprint (scripts/live-update/fingerprint.ts: native sources,
# capacitor.config.ts, Capacitor/Capgo plugin versions) must be the same at this commit as at the
# native release's tag; a release whose shell differs is skipped with a warning, and if none
# matches, nothing is published ("ship a native release instead"). The portal enforces the same
# thing: it only offers a bundle to shells with its fingerprint.
#
# Publishing is scripts/live-update/publish.ts (upload, then release: signed manifest on the portal),
# the same as a v* tag's "Go live". Afterwards the public /api/app-update answer is checked for each
# native release: it must offer this version.
#
# Env: PORTAL_ADMIN_TOKEN and LIVE_UPDATE_SIGNING_KEY (not for --dry-run), PORTAL_URL (default
# https://app.duelbinder.com).
set -euo pipefail
target="" dir="" releases=() dry=false
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) dry=true; shift ;;
    -*) echo "Unknown option: $1" >&2; exit 2 ;;
    *) if [ -z "$target" ]; then target="$1"; elif [ -z "$dir" ]; then dir="$1"; else releases+=("$1"); fi; shift ;;
  esac
done
case "$target" in
  ios) platform=ios ;;
  android-apk | android-play) platform=android ;;
  *) echo "target must be ios, android-apk or android-play" >&2; exit 2 ;;
esac
[ -f "$dir/index.html" ] || { echo "$dir/index.html not found" >&2; exit 2; }
[ "${#releases[@]}" -gt 0 ] || { echo "Name at least one native release (NAME+NUMBER)" >&2; exit 2; }
version="$(node -p "require('./package.json').version")"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "package.json version $version isn't x.y.z" >&2; exit 2; }
portal="${PORTAL_URL:-https://app.duelbinder.com}"
portal="${portal%/}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
newer() { [ "$1" != "$2" ] && [ "$(printf '%s\n%s\n' "$1" "$2" | sort -V | tail -1)" = "$1" ]; }

current="$(npx tsx "$here/fingerprint.ts" "$platform")"
ok=()
for release in "${releases[@]}"; do
  [[ "$release" =~ ^([0-9]+\.[0-9]+\.[0-9]+)\+([0-9]+)$ ]] || { echo "release must be NAME+NUMBER, not $release" >&2; exit 2; }
  name="${BASH_REMATCH[1]}" tag="native/$platform/$release"
  git fetch -q origin "refs/tags/$tag:refs/tags/$tag" 2>/dev/null || git rev-parse -q --verify "refs/tags/$tag" >/dev/null \
    || { echo "::warning::No tag $tag: $release isn't a shipped native release; skipping it."; continue; }
  if [ "$(npx tsx "$here/fingerprint.ts" "$platform" "$tag")" != "$current" ]; then
    echo "::warning::The $platform shell changed since $tag (native code, capacitor.config.ts or a Capacitor plugin): $release can't take this update."
    continue
  fi
  newer "$version" "$name" || { echo "::error::Update version $version isn't newer than native release $name." >&2; exit 1; }
  ok+=("$release")
done
[ "${#ok[@]}" -gt 0 ] || {
  echo "::error::No native release can take this update ($target): ship a native release instead." >&2
  exit 1
}
echo "$target $version for ${ok[*]} (fingerprint $current)"
$dry && { echo "Dry run: not published."; exit 0; }

draft="$(mktemp -d)/release.json"
npx tsx "$here/publish.ts" upload "$target" "$dir" "$draft"
npx tsx "$here/publish.ts" release "$draft"

# The answer is edge-cached per URL for 60 s, so a unique query skips the cache.
bad=0
for release in "${ok[@]}"; do
  name="${release%+*}"
  got="$(curl -fsS "$portal/api/app-update?target=$target&builtin=$name&current=$name&ci=$(date +%s%N)" \
    | node -e 'let s="";process.stdin.on("data",(d)=>(s+=d)).on("end",()=>console.log(JSON.parse(s).version))' || true)"
  if [ "$got" = "$version" ]; then
    echo "Native release $release is offered $version"
  else
    echo "::error::Published, but the portal offers ${got:-nothing} (not $version) to $target $name; check its builtin record."
    bad=1
  fi
done
echo "Published $target $version"
exit "$bad"
