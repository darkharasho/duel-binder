/**
 * Typed Magic codes ("mh3 0123", "MH3-123", "xln 078/279", "plst xln-217") read as the catalog's
 * `set_code` form, "<SET> <number>": "MH3 123", "XLN 78", "PLST XLN-217". The set and number
 * need a separator (a space, "-", "#" or "/") because Magic set codes hold digits ("MH3", "9ED").
 * The set's card count after a slash, as 2015-2022 cards print it, is dropped. A number that
 * starts with digits loses its leading zeros (not a number of zeros only, "00") and keeps what
 * follows in lowercase ("123a", "38†", "130★s"); one that starts with a letter ("S1", "A01") is
 * kept as typed, in capitals. The List's inner set code keeps its dash ("XLN-217"); a year
 * ("PWCS 2024-05") isn't one. Codes are looked up regardless of case, so capitals don't matter.
 */
const CODE = /^([A-Za-z0-9]{2,6})[\s\-#/]+(\S.*)$/u
const INNER_SET = /^([A-Za-z][A-Za-z0-9]{1,5})-(.+)$/u

function collectorNumber(typed: string): string {
  const m = /^(\d+)(.*)$/u.exec(typed)
  if (!m) return typed.toUpperCase()
  const digits = /^0+$/.test(m[1]) ? m[1] : m[1].replace(/^0+/, '')
  return `${digits}${m[2].toLowerCase()}`
}

export function normalizeMagicCode(text: string): string | null {
  const m = CODE.exec(text.trim())
  if (!m) return null
  const set = m[1].toUpperCase()
  const rest = m[2].replace(/\s+/g, '').replace(/^(\d+)\/\d+$/, '$1')
  const inner = INNER_SET.exec(rest)
  return inner
    ? `${set} ${inner[1].toUpperCase()}-${collectorNumber(inner[2])}`
    : `${set} ${collectorNumber(rest)}`
}
