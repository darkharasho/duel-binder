import { reverseChecked, reverseVersion } from '@shared/scan/reverseHolo'
import type { ScanDraft } from '@shared/scan/types'
import type { ResolveContext } from './resolve'
import type { VersionCues } from './vision/pokemonVersion'

/**
 * A draft of an English card whose only versions are Normal and Reverse Holofoil, set to the one
 * its body brightness reads as (reverseVersion), flag cleared: the foil boxes can't tell them.
 * `item` itself when the check doesn't apply: it is off (no refs), no body was measured, no
 * reference covers the image, the options are anything but that pair in English, or the set isn't
 * a checked one. The caller leaves out a best guess.
 */
export function applyReverseCheck(
  item: ScanDraft,
  cues: VersionCues | null | undefined,
  refs: ResolveContext['reverseRefs']
): ScanDraft {
  if (!refs || !cues?.body) return item
  const ref = refs(item.imageId)
  if (!ref) return item
  const { options } = item
  if (options.length !== 2 || options.some((o) => o.language !== 'en')) return item
  const normal = options.find((o) => o.rarity === 'Normal')
  const reverse = options.find((o) => o.rarity === 'Reverse Holofoil')
  if (!normal || !reverse || !options.every((o) => reverseChecked(o.setCode))) return item
  // On purpose this also settles a draft already unflagged: the body cue replaces the
  // frame-cue verdict for this pair.
  const named = reverseVersion(cues.body, ref) === 'Normal' ? normal : reverse
  return {
    ...item,
    printingId: named.printingId,
    setCode: named.setCode,
    rarity: named.rarity,
    flag: null
  }
}
