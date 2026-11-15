import type { GameId } from '@shared/games'
import type { Prefs } from '@shared/prefs'
import type { WashState } from '@/components/artWashContext'
import { colourlessFamilies, gameFallback } from './sample'

/** The wash to paint: the page's own (Random), its pattern in fixed colours (Locked) or a dim grey (Colourless). */
export function applyWashPref(
  wash: WashState | null,
  pref: Prefs['wash'],
  game: GameId
): WashState {
  if (pref.mode === 'colourless')
    return { families: colourlessFamilies(game), seed: 0, strength: 0.4 }
  if (pref.mode === 'locked' && pref.locked)
    return {
      families: { ...pref.locked, greyArt: false },
      seed: wash?.seed ?? 0,
      strength: wash?.strength ?? 1
    }
  return wash ?? { families: gameFallback(game), seed: 0, strength: 1 }
}
