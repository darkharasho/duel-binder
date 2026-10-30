/** A Pokémon card's printed collector number, e.g. `PAL EN 045/193`: set abbreviation (when read), number, set total. */
export interface CollectorNumber {
  setAbbrev: string | null
  number: string
  total: string | null
}

const LANG_TAGS = new Set([
  'EN',
  'JA',
  'JP',
  'FR',
  'DE',
  'IT',
  'ES',
  'PT',
  'KO',
  'ZH',
  'ID',
  'TH',
  'NL',
  'PL',
  'RU'
])
// A number or total: optional letter prefix (TG, GG, SV, RC), then digits.
const TOKEN = '[A-Z]{0,4}\\d{1,4}'
const SLASHED = new RegExp(`(?<![A-Z0-9])(${TOKEN})\\s*/\\s*(${TOKEN})(?![A-Z0-9])`)
// No total printed (promos): an attached prefix like SWSH062 or SV049.
const BARE = /(?<![A-Z0-9])([A-Z]{2,4}\d{2,4})(?![A-Z0-9])/

/** A set abbreviation among the words around the number: letters and digits, not a language tag or HP. */
function abbrevIn(words: string): string | null {
  const found = words
    .split(/[^A-Z0-9]+/)
    .filter((w) => /^[A-Z0-9]{2,5}$/.test(w) && /[A-Z]/.test(w) && w !== 'HP' && !LANG_TAGS.has(w))
  return found.length ? found[found.length - 1] : null
}

export function parseCollectorNumber(text: string): CollectorNumber | null {
  const up = text.toUpperCase()
  const m = SLASHED.exec(up)
  if (m) {
    const before = abbrevIn(up.slice(0, m.index))
    const after = abbrevIn(up.slice(m.index + m[0].length))
    return { setAbbrev: before ?? after, number: m[1], total: m[2] }
  }
  const b = up.includes('/') ? null : BARE.exec(up)
  if (!b || b[1].startsWith('HP')) return null
  return { setAbbrev: abbrevIn(up.slice(0, b.index)), number: b[1], total: null }
}

const DIGIT_FIX: Record<string, string> = {
  O: '0',
  I: '1',
  L: '1',
  '|': '1',
  S: '5',
  B: '8',
  Z: '2'
}
const LOOSE = /([A-Z0-9OILSBZ|]{1,6})\s*\/\s*([A-Z0-9OILSBZ|]{1,6})/

const toDigits = (s: string): string => s.replace(/[OILSBZ|]/g, (c) => DIGIT_FIX[c])

/**
 * The readings of one side: as read, all digits, and a kept letter prefix with digits after it.
 * Then, as a blurred read runs the regulation mark and set badge into the number ("HWMB129")
 * and noise onto the total ("1420"), the number's last digits and the total's first three.
 */
function sides(tok: string, side: 'number' | 'total'): string[] {
  const out = [tok, toDigits(tok)]
  const prefixed = /^([A-Z]{2,})(.+)$/.exec(tok)
  if (prefixed) out.push(prefixed[1] + toDigits(prefixed[2]))
  const run = side === 'number' ? /[A-Z](\d{1,3})$/.exec(tok) : /^(\d{3})\d+$/.exec(tok)
  if (run) out.push(run[1])
  return out.filter((s) => new RegExp(`^${TOKEN}$`).test(s))
}

/**
 * parseCollectorNumber first, then the readings with O, I/l, S, B, Z taken for the digits they
 * look like (`O45/l93` → `045/193`). Try them in order.
 */
export function collectorNumberCandidates(text: string): CollectorNumber[] {
  const first = parseCollectorNumber(text)
  const out: CollectorNumber[] = first ? [first] : []
  const up = text.toUpperCase()
  const m = LOOSE.exec(up)
  if (m) {
    const setAbbrev =
      first?.setAbbrev ??
      abbrevIn(up.slice(0, m.index)) ??
      abbrevIn(up.slice(m.index + m[0].length))
    for (const number of sides(m[1], 'number'))
      for (const total of sides(m[2], 'total')) out.push({ setAbbrev, number, total })
  }
  const seen = new Set<string>()
  return out.filter((c) => {
    const key = `${c.setAbbrev}|${c.number}|${c.total}`
    return !seen.has(key) && seen.add(key)
  })
}
