/** The part of a set code before the first dash, or the whole code if none. */
export function setPrefix(code: string): string {
  const i = code.indexOf('-')
  return i === -1 ? code : code.slice(0, i)
}

/** The part of a set code after the first dash, or null if there is no dash. */
function afterDash(code: string): string | null {
  const i = code.indexOf('-')
  return i === -1 ? null : code.slice(i + 1)
}

/**
 * The numeric part of a set code (letter prefix/suffix allowed), e.g. LOB-EN005 -> 5 / '005', or
 * of a Pokémon number, e.g. PAR 150/182 -> 150 / '150'.
 */
export function setNumber(code: string): { number: number | null; label: string } {
  const m =
    /^[A-Za-z]*(\d+)[A-Za-z]*$/.exec(afterDash(code) ?? '') ??
    /^\S+ [A-Za-z]*(\d+)[A-Za-z]*(?:\/\S+)?$/.exec(code)
  return m ? { number: parseInt(m[1], 10), label: m[1] } : { number: null, label: '' }
}

/**
 * Index of the code to use by default. The pool is the owned codes if any,
 * else all codes. Within the pool: the first regionless code (digits only
 * after the dash), else the first containing "-EN", else the first.
 */
export function pickDefaultCode(codes: { setCode: string; owned: number }[]): number {
  const all = codes.map((_, i) => i)
  const owned = all.filter((i) => codes[i].owned > 0)
  const pool = owned.length > 0 ? owned : all
  const regionless = pool.find((i) => /^\d+$/.test(afterDash(codes[i].setCode) ?? ''))
  if (regionless !== undefined) return regionless
  const en = pool.find((i) => codes[i].setCode.includes('-EN'))
  return en ?? pool[0]
}
