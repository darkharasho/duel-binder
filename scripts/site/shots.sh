#!/usr/bin/env bash
# Captures the app (fake-data profile, 2x) to out/shots/*.png, then converts to WebP for the site.
set -euo pipefail
cd "$(dirname "$0")/../.."
rm -rf out/shots
npx cross-env YGO_FAKE_DATA=1 YGO_CAPTURE_DIR=out/shots electron-vite dev
mkdir -p workers/portal/site/shots
for name in collection dashboard sets; do
  magick "out/shots/$name.png" -quality 82 "workers/portal/site/shots/$name.webp"
done
