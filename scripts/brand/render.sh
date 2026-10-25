#!/usr/bin/env bash
# Renders every brand PNG/ICO/favicon from the SVG sources in resources/brand.
# Run from the repo root: bash scripts/brand/render.sh
set -euo pipefail

for tool in rsvg-convert magick; do
  command -v "$tool" >/dev/null || { echo "missing required tool: $tool" >&2; exit 1; }
done
if ! fc-match "IBM Plex Sans:semibold" | grep -q "IBM Plex Sans"; then
  echo "IBM Plex Sans is not installed for fontconfig." >&2
  echo "Install the IBM Plex Sans TTFs into ~/.local/share/fonts and run fc-cache -f." >&2
  exit 1
fi

B=resources/brand
SITE=workers/portal/site
mkdir -p "$SITE" build src/renderer/src/assets
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

rsvg-convert -w 1024 -h 1024 "$B/square.svg" -o build/icon.png
rsvg-convert -w 512 -h 512 "$B/square.svg" -o resources/icon.png
rsvg-convert -w 180 -h 180 "$B/square.svg" -o "$SITE/apple-touch-icon.png"
rsvg-convert -w 1024 -h 1024 "$B/circle.svg" -o "$B/discord-icon.png"
for s in 16 32 48; do rsvg-convert -w "$s" -h "$s" "$B/small.svg" -o "$tmp/$s.png"; done
magick "$tmp/16.png" "$tmp/32.png" "$tmp/48.png" "$SITE/favicon.ico"
cp "$B/small.svg" "$SITE/favicon.svg"
cp "$B/square.svg" src/renderer/src/assets/logo.svg
rsvg-convert -w 1200 -h 630 "$B/og.svg" -o "$SITE/og.png"
echo "brand assets rendered"
