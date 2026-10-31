import type { DexMissing, DexMissReason } from '@shared/dex/match'

export const DEX_MISS_TEXT: Record<DexMissReason, string> = {
  quantity: "Quantity couldn't be read",
  language: 'Language not in our catalog yet',
  set: 'Set not in our catalog',
  number: 'Card number not in this set',
  name: "Card name doesn't match this number",
  finish: 'Version not in our catalog',
  image: 'No picture for this card yet'
}

/** The not-imported list as tab-separated lines, for a spreadsheet or a note. */
export function notImportedText(rows: DexMissing[]): string {
  const lines = rows.map((r) =>
    [r.name, r.set, r.number, r.variant, r.locale, r.quantity, DEX_MISS_TEXT[r.reason]].join('\t')
  )
  return [
    ['Name', 'Set', 'Number', 'Variant', 'Language', 'Quantity', 'Reason'].join('\t'),
    ...lines
  ].join('\n')
}
