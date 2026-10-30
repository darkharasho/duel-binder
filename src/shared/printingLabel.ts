/**
 * How every printing picker names a printing: its code as a chip, then its set's name and its
 * rarity, as "[YAC1-JP001] Original Art Collection - Super Rare". A printing with no code (YAC1's
 * Manga-Style ones) has no chip; its set's name still comes first. Display only.
 */

import { englishSetName, hasNativeScript } from './setNames'

export interface PrintingLabelInput {
  /** The printing's code, e.g. "YAC1-JP001"; empty when it has none. */
  setCode: string
  setName: string
  rarity: string
  /** The art variant, e.g. "Overframe" or "Manga-Style"; absent or null when plain. */
  variant?: string | null
}

/** "Prismatic Secret Rare (Overframe)": the rarity, and the art variant when it doesn't already say it. */
export function rarityLabel(rarity: string, variant?: string | null): string {
  const v = variant?.trim()
  return v && !rarity.toLowerCase().includes(v.toLowerCase()) ? `${rarity} (${v})` : rarity
}

/**
 * What follows the chip: "Original Art Collection - Super Rare", or the rarity alone with no set name.
 * The set shows its English name (see englishSetName); with none known it is left out, as the chip
 * already shows the code.
 */
export function printingTitle(p: PrintingLabelInput): string {
  const rarity = rarityLabel(p.rarity, p.variant)
  const name = p.setName.trim()
  const set = englishSetName(name)
  if (hasNativeScript(set)) return p.setCode.trim() ? rarity : `${set} - ${rarity}`
  return set ? `${set} - ${rarity}` : rarity
}

/** The chip's text, the printing's code; null when it has none, so no chip shows. */
export function printingChip(p: Pick<PrintingLabelInput, 'setCode'>): string | null {
  const code = p.setCode.trim()
  return code || null
}

/**
 * The whole label as plain text, "YAC1-JP001 Original Art Collection - Super Rare", for where only
 * text goes (an accessible name, a fallback label), with " · JP" when a language tag is given.
 */
export function printingText(p: PrintingLabelInput, languageTag?: string): string {
  const chip = printingChip(p)
  const text = chip ? `${chip} ${printingTitle(p)}` : printingTitle(p)
  return languageTag ? `${text} · ${languageTag}` : text
}

/**
 * Lower-case text a printing picker's search matches: code, set name (English and the catalog's
 * own), rarity and language tag.
 */
export function printingSearch(p: PrintingLabelInput, languageTag?: string): string {
  const english = englishSetName(p.setName)
  const names = english === p.setName ? [p.setName] : [english, p.setName]
  return [p.setCode, ...names, rarityLabel(p.rarity, p.variant), languageTag ?? '']
    .join(' ')
    .trim()
    .toLowerCase()
}
