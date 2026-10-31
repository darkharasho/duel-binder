/**
 * Yu-Gi-Oh! printing rarities as stored. YGOPRODeck and Yugipedia set lists both leak other columns
 * (a print note, a quantity) into the rarity slot, and spell a few rarities two ways. Every source
 * that writes `card_printings.set_rarity` goes through `cleanRarity`.
 */

/** Spellings that are one rarity. Keys are lower case. */
const SPELLINGS: Record<string, string> = {
  'platinum secret rare': 'Platinum Secret Rare',
  'extra secret': 'Extra Secret Rare',
  starfoil: 'Starfoil Rare'
}

/**
 * Values that are not rarities: a quantity ("2"), a print note ("New", "Reprint", "New artwork"), a
 * regional debut note, and "Cr", a stray in RA04-DE055 beside its real rarities.
 */
const NOT_A_RARITY = [
  /^\d+$/,
  /^new( art(work)?)?$/i,
  /^reprint$/i,
  /^(european|oceanian)( & (european|oceanian))? debut$/i,
  /^Cr$/
]

export const isJunkRarity = (raw: string): boolean => NOT_A_RARITY.some((re) => re.test(raw.trim()))

/** Whether a rarity slot actually holds the "New artwork" print note. */
export const isNewArtNote = (raw: string): boolean => /^new art(work)?$/i.test(raw.trim())

/** One spelling per rarity, and one casing of the "Alternate Art" label TCGplayer and the wiki share. */
export function canonRarity(raw: string): string {
  const r = raw.trim().replace(/\balternate art\b/gi, 'Alternate Art')
  return SPELLINGS[r.toLowerCase()] ?? r
}

/** The rarity to store, or null for a value that is no rarity (the printing stays out). */
export function cleanRarity(raw: string): string | null {
  return raw.trim() === '' || isJunkRarity(raw) ? null : canonRarity(raw)
}
