import type { ScanDraft } from '../../src/shared/scan/types'

/** A row of the private truth file, as the real-photo tests read it. */
export interface Truth {
  /** Relative to SCAN_PKM_DIR. */
  file: string
  source: 'owner' | 'ebay'
  /** TCGdex-derived, as pokemonId takes it ('en/sv03-045'); null when the card isn't known. */
  sourceId: string | null
  version: string | null
  language: 'en' | 'ja' | 'zh' | 'other'
  holder: 'bare' | 'toploader' | 'case' | 'slab'
  unclear?: 'card' | 'version'
  /** A printed stamp the photo shows ('1st Edition', 'STAFF', '25th logo', ...). Its version is
   *  the catalog's label for it, or null (unclear 'version') when the catalog has none. */
  stamp?: string
}

/**
 * What a named card got wrong for a photo: another card, another language, a version named as sure
 * that isn't the photo's, a graded tag on a card that isn't in a slab, or any card at all for a
 * Chinese, other-language or unknown card. Empty when it's right.
 */
export function problemsOf(t: Truth, cardId: number | null, item: ScanDraft): string[] {
  const lang = item.options.find((o) => o.printingId === item.printingId)?.language
  const problems: string[] = []
  if (t.language !== 'en' && t.language !== 'ja') problems.push(`a ${t.language} card`)
  else if (cardId === null) problems.push('a card not known')
  else if (item.cardId !== cardId) problems.push('another card')
  else if (lang !== t.language) problems.push('another language')
  // A version is scored only on a card with several in the photo's language: options span
  // both languages, and a lone version's label may differ from the truth's.
  const versions = new Set(
    item.options.filter((o) => o.language === t.language).map((o) => o.rarity)
  )
  if (
    item.flag === null &&
    versions.size > 1 &&
    t.version !== null &&
    t.unclear !== 'version' &&
    item.rarity !== t.version
  )
    problems.push('another version')
  if (item.slab === true && t.holder !== 'slab') problems.push(`slab on a ${t.holder}`)
  return problems
}
