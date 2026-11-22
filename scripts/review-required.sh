#!/usr/bin/env bash
# Usage: review-required.sh <NAME>   (an iOS version waiting for App Store review or in review)
# Exits 0 when that version has to be reviewed: it has changes no over-the-air update can bring to
# the version the App Store has live, so pulling it from review would hold them back for good while
# newer builds keep replacing it. Exits 1 when it doesn't (live installs already get everything in it
# as updates), so a newer build may take its place. Prints why either way. asc-submit.py --keep-required
# (and so reconcile) runs it on each version in flight before pulling one.
#
# How: checks out that version's build (newest <prefix>/ios/<NAME+NUMBER> tag) in a temporary
# worktree and runs the repo's native check there against the live version's build: would an update
# made from it reach live installs? The check is the one the update workflow already uses:
#   NATIVE_CHECK   command, called as `<command> ios <live NAME+NUMBER>` from the worktree's root;
#                  exits 0 when nothing native changed since that release (default:
#                  scripts/native-check.sh). Taken from this checkout, so it works on versions
#                  older than the check; it must compare HEAD (the worktree) with the tag.
#   NATIVE_TAG_PREFIX  native release tags' prefix (default: native).
#   BUNDLE_ID      for the App Store lookup; LIVE_VERSION overrides that lookup (for trying it out).
# Unsure counts as required: no live version, no tag for either version, or a check that can't run.
# Needs a git remote named origin.
set -euo pipefail
name="${1:?NAME}"
prefix="${NATIVE_TAG_PREFIX:-native}" check="${NATIVE_CHECK:-scripts/native-check.sh}"
bundle="${BUNDLE_ID:?BUNDLE_ID}"

tag_for() {
  git ls-remote --tags origin "refs/tags/$prefix/ios/$1+*" \
    | sed -nE "s#^.*refs/tags/($prefix/ios/${1//./\\.}\+[0-9]+)\$#\1#p" | sort -t+ -k2,2n | tail -1
}

live="${LIVE_VERSION:-}"
[ -n "$live" ] || live="$(curl -fsS "https://itunes.apple.com/lookup?bundleId=$bundle&country=us" \
  | python3 -c 'import json,sys; r=json.load(sys.stdin)["results"]; print(r[0]["version"] if r else "")' || true)"
[ -n "$live" ] || { echo "The App Store has no live version, so $name needs review."; exit 0; }
[ "$live" != "$name" ] || { echo "$name is already the App Store's live version."; exit 1; }
waiting="$(tag_for "$name")" store="$(tag_for "$live")"
[ -n "$waiting" ] || { echo "No $prefix/ios tag for $name; treating it as needing review."; exit 0; }
[ -n "$store" ] || { echo "No $prefix/ios tag for live $live; treating $name as needing review."; exit 0; }
git fetch -q origin "refs/tags/$waiting:refs/tags/$waiting" "refs/tags/$store:refs/tags/$store"
# This checkout's check (older versions may predate it), run with the worktree as HEAD.
read -r check_cmd check_args <<<"$check"
[ -f "$check_cmd" ] && check_cmd="$(cd "$(dirname "$check_cmd")" && pwd)/$(basename "$check_cmd")"

tree="$(mktemp -d)"
trap 'git worktree remove --force "$tree" >/dev/null 2>&1 || true; rm -rf "$tree"' EXIT
git worktree add -q --detach "$tree" "$waiting" \
  || { echo "Couldn't check out $waiting; treating $name as needing review."; exit 0; }
set +e
# shellcheck disable=SC2086  # check_args splits on purpose
out="$(cd "$tree" && "$check_cmd" $check_args ios "${store#"$prefix"/ios/}" 2>&1)"
status=$?
set -e
sed 's/^/  /' <<<"$out"
if [ "$status" = 0 ]; then
  echo "$name has nothing live $live can't get as an update."
  exit 1
fi
echo "$name needs review: an update can't bring live $live up to it."
exit 0
