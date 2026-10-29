import type { Language } from '../../shared/languages'

/** European languages whose printings share a TCG product line with the English one. */
export const EU_LANGUAGES: readonly Language[] = ['de', 'fr', 'it', 'es', 'pt']

const TWO_LETTER = ['DE', 'FR', 'IT', 'SP', 'PT']
const ONE_LETTER = ['G', 'F', 'I', 'S', 'P']

/** The English set code for a European one (LOB-DE001 -> LOB-EN001, LOB-G001 -> LOB-E001); null otherwise. */
export function enTwinCode(code: string): string | null {
  const dash = code.indexOf('-')
  if (dash < 0) return null
  const head = code.slice(0, dash + 1)
  const rest = code.slice(dash + 1)
  if (TWO_LETTER.includes(rest.slice(0, 2).toUpperCase())) return `${head}EN${rest.slice(2)}`
  if (ONE_LETTER.includes(rest.slice(0, 1).toUpperCase()) && /^\d/.test(rest.slice(1)))
    return `${head}E${rest.slice(1)}`
  return null
}

const DASH = `instr(p.set_code, '-')`
const REGION = `substr(p.set_code, ${DASH} + 1, 2)`
const TWIN_CODE = `CASE
  WHEN ${REGION} IN ('DE','FR','IT','SP','PT')
    THEN substr(p.set_code, 1, ${DASH}) || 'EN' || substr(p.set_code, ${DASH} + 3)
  WHEN substr(${REGION}, 1, 1) IN ('G','F','I','S','P') AND substr(${REGION}, 2, 1) BETWEEN '0' AND '9'
    THEN substr(p.set_code, 1, ${DASH}) || 'E' || substr(p.set_code, ${DASH} + 2)
END`

/**
 * The English twin's TCGplayer market price (same game, card, rarity and set number), or NULL. A scalar
 * subquery over alias `p`; it hits ux_printings_en (card_id, set_code, set_rarity), a point lookup.
 */
export const EN_TWIN_PRICE = `(SELECT en.market_price FROM card_printings en
  WHERE p.language IN ('de','fr','it','es','pt') AND en.language = 'en' AND en.game = p.game AND en.card_id = p.card_id
    AND en.set_rarity = p.set_rarity AND en.set_code = ${TWIN_CODE})`
