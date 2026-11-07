#!/usr/bin/env bash
# Uploads the 1025 Pokédex sprites (PokeAPI black-white, 96x96 PNG) to the portal's R2 bucket
# as sprite/<n>.png, which the Worker serves at /img/sprite/<n>.
#
# Run once by hand from workers/portal:  bash ../../scripts/pokedex/upload-sprites.sh
# Re-running overwrites every sprite. Exits non-zero if any sprite failed to download,
# validate or upload (the counts are printed first).
set -u

BUCKET="duel-binder-images"
SIZE=1025
JOBS=8
URL_BASE="https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/versions/generation-v/black-white"

dir="$(mktemp -d)"
trap 'rm -rf "$dir"' EXIT
mkdir -p "$dir/ok" "$dir/fail"

one() {
  n="$1"
  f="$dir/$n.png"
  if ! curl -fsS --retry 2 -o "$f" "$URL_BASE/$n.png" 2>/dev/null; then : >"$dir/fail/$n"; return; fi
  if ! file -b "$f" | grep -q 'PNG image data, 96 x 96'; then : >"$dir/fail/$n"; return; fi
  if npx wrangler r2 object put "$BUCKET/sprite/$n.png" --file "$f" --content-type image/png --remote >/dev/null 2>&1; then
    : >"$dir/ok/$n"
  else
    : >"$dir/fail/$n"
  fi
}
export -f one
export dir BUCKET URL_BASE

seq 1 "$SIZE" | xargs -P "$JOBS" -I{} bash -c 'one {}'

uploaded=$(find "$dir/ok" -type f | wc -l)
failed=$(find "$dir/fail" -type f | wc -l)
echo "uploaded: $uploaded, failed: $failed"
if [ "$failed" -ne 0 ]; then
  echo "failed numbers: $(ls "$dir/fail" | sort -n | tr '\n' ' ')" >&2
  exit 1
fi
