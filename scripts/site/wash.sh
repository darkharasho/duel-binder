#!/usr/bin/env bash
# Builds the blurred card-art backdrops for the marketing site from public card art: the page wash
# (Dark Magician) and one small wash per game for the games strip, blurred until only colour is left.
set -euo pipefail
cd "$(dirname "$0")/.."/..
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
UA="DuelBinderSiteBuild/1.0"
get() { curl -fsSL -A "$UA" "$1" -o "$2"; sleep 0.2; }
get "https://images.ygoprodeck.com/images/cards_cropped/46986414.jpg" "$tmp/ygo.jpg"
get "https://assets.tcgdex.net/en/base/base1/4/high.jpg" "$tmp/pkm-card.jpg"
get "https://api.scryfall.com/cards/named?exact=Emrakul%2C%20the%20Aeons%20Torn&format=image&version=art_crop" "$tmp/mtg.jpg"
get "https://en.onepiece-cardgame.com/images/cardlist/card/OP01-001.png" "$tmp/op-card.png"
# Full cards: keep the art box only.
magick "$tmp/pkm-card.jpg" -gravity north -crop 84%x44%+0+60 +repage "$tmp/pkm.jpg"
magick "$tmp/op-card.png" -background black -flatten -gravity north -crop 90%x50%+0+60 +repage "$tmp/op.jpg"
mkdir -p workers/portal/site/img/games
magick "$tmp/ygo.jpg" -resize 480x -blur 0x24 -quality 70 workers/portal/site/img/wash.webp
for game in ygo pkm mtg op; do
  magick "$tmp/$game.jpg" -resize 320x -blur 0x28 -quality 70 "workers/portal/site/img/games/$game.webp"
done
