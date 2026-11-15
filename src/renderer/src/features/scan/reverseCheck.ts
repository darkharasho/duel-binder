import { reverseChecked, reverseVersion } from '@shared/scan/reverseHolo'
import type { ScanDraft, ScanPrinting } from '@shared/scan/types'
import type { RawSignals } from './engine'
import type { ResolveContext } from './resolve'
import type { VersionCues } from './vision/pokemonVersion'

/**
 * A draft of an English card whose only versions are Reverse Holofoil and one other, Normal or
 * (a holo rare) Holofoil, set to the one its body brightness reads as (reverseVersion), flag
 * cleared: the foil boxes can't tell them. A holo rare's foil is in its art window, so its body
 * reads like a Normal card's against the reference.
 * `item` itself when the check doesn't apply: it is off (no refs), no body was measured, no
 * reference covers the image, the options are anything but such a pair in English, or the set isn't
 * a checked one, or the card is in a graded slab or its art was found only by the holder search
 * (the body measure is off there). The caller leaves out a best guess.
 */
export function applyReverseCheck(
  item: ScanDraft,
  raw: Pick<RawSignals, 'slab' | 'artVia'> & { version?: VersionCues | null },
  refs: ResolveContext['reverseRefs']
): ScanDraft {
  if (raw.slab || raw.artVia === 'holder') return item
  const cues = raw.version
  if (!refs || !cues?.body) return item
  const ref = refs(item.imageId)
  if (!ref) return item
  const { options } = item
  if (options.length !== 2 || options.some((o) => o.language !== 'en')) return item
  const plain = options.find((o) => o.rarity === 'Normal' || o.rarity === 'Holofoil')
  const reverse = options.find((o) => o.rarity === 'Reverse Holofoil')
  if (!plain || !reverse || !options.every((o) => reverseChecked(o.setCode))) return item
  // On purpose this also settles a draft already unflagged: the body cue replaces the
  // frame-cue verdict for this pair.
  const named = reverseVersion(cues.body, ref) === 'Normal' ? plain : reverse
  return {
    ...item,
    printingId: named.printingId,
    setCode: named.setCode,
    rarity: named.rarity,
    flag: null
  }
}

/**
 * The same Pokémon printing in the other of reverse holo and not: a Normal's or Holofoil's
 * Reverse Holofoil, a Reverse Holofoil's Normal (else its Holofoil); same card, set code and
 * language. Other stamped and pattern versions are no twins, on either side. Null when it has no
 * such twin.
 */
export function reverseTwin(p: ScanPrinting, all: ScanPrinting[]): ScanPrinting | null {
  const wants =
    p.rarity === 'Reverse Holofoil'
      ? ['Normal', 'Holofoil']
      : p.rarity === 'Normal' || p.rarity === 'Holofoil'
        ? ['Reverse Holofoil']
        : []
  for (const want of wants) {
    const twin = all.find(
      (o) =>
        o.printingId !== p.printingId &&
        o.cardId === p.cardId &&
        o.setCode === p.setCode &&
        o.language === p.language &&
        o.rarity === want
    )
    if (twin) return twin
  }
  return null
}
