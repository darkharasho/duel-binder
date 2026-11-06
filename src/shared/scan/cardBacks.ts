import type { GameId } from '../games/types'
import { hamming, HASH_WORDS } from './fingerprint'

/**
 * A game's card back, as the art hash (artHash of the profile's art box) of the back straightened
 * as a card, each way up: a card back is a card-shaped picture that matches some artwork a little
 * (a basic Energy's plain art, mostly) and nothing well, so a pile of them on the desk would
 * otherwise be named as whichever card it comes closest to. Each is eight 32-bit words in hex.
 *
 * Pokémon: the backs in five of the owner's own scan frames (2026-10-31), outlined cleanly, so a
 * back under another outline, a sleeve's edge or the desk around it, still comes close to one.
 * Yu-Gi-Oh! and One Piece have none yet.
 */
const CARD_BACKS: Partial<Record<GameId, readonly string[]>> = {
  pkm: [
    '0171c683396c98bda736defb9634e8cc1da6a193c419f249ccf3e19e71b3038c',
    '06d48223390b10bd3df35ad3fed8ca782b262c9c35e613e6f63b6c334c58a65c',
    '807984011b4b9c2d670edcf3b7b6d8cc936c6d82d99ce69995e459e49e6431b3',
    '0394e0633f0fe02d15f31288d65b59634c39f4d892eeca3c19e339c4b3a7d3b3',
    '1fd49063f80b90fde572faf284dc8a58032625b784bbd2a7865ecc3b09932dce',
    '0171c683b92ed8bdf736defb10b6e84c5da6a183c49952698ce3698e71b3138c',
    '82d4f8231f4bd82df57352c2e6dcef34e923bd84b4c9d364c318ed315dc411c4',
    '107da74346f27f0e98cbe73c6c4e95326582b596669812c4a66b1be6d966f81a',
    '80d4f7231f42d82de53242f2b485eb4c5365ada56e9976d113c44bd473312df5',
    '0075840363c1ff2d634dc4b4673e98f3e33ad8eeb76459865b84cc99663d44e5'
  ]
}

const parsed = new Map<GameId, Uint32Array>()

/** A game's card backs' hashes back to back (HASH_WORDS words each); null for none. */
function cardBacks(game: GameId): Uint32Array | null {
  const hex = CARD_BACKS[game]
  if (!hex?.length) return null
  let out = parsed.get(game)
  if (!out) {
    out = new Uint32Array(hex.length * HASH_WORDS)
    hex.forEach((h, i) => {
      for (let w = 0; w < HASH_WORDS; w++)
        out![i * HASH_WORDS + w] = parseInt(h.slice(w * 8, w * 8 + 8), 16)
    })
    parsed.set(game, out)
  }
  return out
}

/** Whether the game has card backs to tell (cardBackDistance gives null otherwise). */
export const hasCardBacks = (game: GameId): boolean => cardBacks(game) !== null

/** How close an art hash is to the game's nearest card back; null when it has none. */
export function cardBackDistance(game: GameId, hash: Uint32Array): number | null {
  const backs = cardBacks(game)
  if (!backs) return null
  let best = Infinity
  for (let off = 0; off < backs.length; off += HASH_WORDS)
    best = Math.min(best, hamming(hash, 0, backs, off))
  return best
}
