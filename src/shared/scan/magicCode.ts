/**
 * Typed Magic codes ("mh3 0123", "MH3-123", "plst xln-217") read as the catalog's `set_code`
 * form, "<SET> <number>": "MH3 123", "PLST XLN-217". The set and number need a separator (a space,
 * "-", "#" or "/") because Magic set codes hold digits ("MH3", "9ED"); a number keeps its letter
 * suffix in lowercase ("123a") and a ★, and loses its leading zeros. The List's inner set code
 * keeps its dash ("XLN-217").
 */
const CODE = /^([A-Z0-9]{2,6})[\s\-#/]+(?:([A-Z0-9]{2,6})-)?0*(\d+)([A-Z]*)(★?)$/

export function normalizeMagicCode(text: string): string | null {
  const m = CODE.exec(text.trim().toUpperCase())
  if (!m) return null
  const [, set, inner, number, suffix, star] = m
  return `${set} ${inner ? `${inner}-` : ''}${number}${suffix.toLowerCase()}${star}`
}
