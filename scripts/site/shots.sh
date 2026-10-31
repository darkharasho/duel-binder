#!/usr/bin/env bash
# Captures the app (2x, off screen) to out/shots/*.png, then converts to WebP for the site. The
# capture profile gets a copy of the local app's catalog, both games, with everything personal
# deleted; its collection is the fake-data seed.
set -euo pipefail
cd "$(dirname "$0")/../.."
SOURCE="${XDG_CONFIG_HOME:-$HOME/.config}/duel-binder/collection.db"
PROFILE="${XDG_CONFIG_HOME:-$HOME/.config}/duel-binder-fake-data-capture"
mkdir -p "$PROFILE"
rm -f "$PROFILE"/collection.db*
sqlite3 "file:$SOURCE?mode=ro" ".backup '$PROFILE/collection.db'"
sqlite3 "$PROFILE/collection.db" <<'SQL'
PRAGMA foreign_keys = OFF;
DELETE FROM collection_entries;
DELETE FROM wishlist_entries;
DELETE FROM value_snapshots;
DELETE FROM cloud_accounts;
DELETE FROM cloud_game_cursors;
DELETE FROM sync_issues;
DELETE FROM sync_pending;
DELETE FROM price_requests;
DELETE FROM rip_pulls;
DELETE FROM rip_sessions;
DELETE FROM meta WHERE key LIKE 'cloud_%' OR key = 'active_game';
SQL
rm -rf out/shots
for game in ygo pkm; do
  npx cross-env YGO_FAKE_DATA=1 YGO_CAPTURE_DIR=out/shots YGO_CAPTURE_GAME="$game" electron-vite preview
done
mkdir -p workers/portal/site/shots
for name in collection collection-pokemon dashboard sets; do
  magick "out/shots/$name.png" -quality 82 "workers/portal/site/shots/$name.webp"
done
