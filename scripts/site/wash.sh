#!/usr/bin/env bash
# Builds the blurred card-art backdrop for the marketing site from public Dark Magician art.
set -euo pipefail
cd "$(dirname "$0")/.."/..
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
curl -fsSL "https://images.ygoprodeck.com/images/cards_cropped/46986414.jpg" -o "$tmp/art.jpg"
mkdir -p workers/portal/site/img
magick "$tmp/art.jpg" -resize 480x -blur 0x24 -quality 70 workers/portal/site/img/wash.webp
