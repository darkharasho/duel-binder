export { setPrefix } from '../sets'

const CODE = /([A-Z0-9]{2,5})\s*[-–]\s*([A-Z]{2})?\s*([A-Z0-9]{2,4})/
const UNDASHED = /([A-Z0-9]{3,4})EN([A-Z0-9]{2,4})/
const DIGIT_FIX: Record<string, string> = { O: '0', I: '1', L: '1', S: '5', B: '8', Z: '2' }

const toDigits = (s: string): string => s.replace(/[OILSBZ]/g, (c) => DIGIT_FIX[c])

/** The number part of a code, OCR-corrected; a single leading letter survives (e.g. `A01`). */
function fixNumber(num: string): string | null {
  const tail = toDigits(num.slice(1))
  if (/^[A-Z]/.test(num) && /^\d{2,3}$/.test(tail)) return num[0] + tail
  const all = toDigits(num)
  return /^\d{2,4}$/.test(all) ? all : null
}

/**
 * Normalizes OCR text to a `PREFIX-ENnnn` set code. Returns null when nothing parses or the region
 * isn't EN; a code with no region comes back as `PREFIX-nnn` so the caller can retry with EN.
 * OCR often drops the thin dash, so `PREFIXENnnn` (3–4 character prefix, EN only) parses too.
 */
export function parseSetCode(text: string): string | null {
  const upper = text.toUpperCase()
  const m = CODE.exec(upper)
  if (!m) return parseUndashed(upper)
  const [, prefix, region, num] = m
  if (region && region !== 'EN') return null
  const number = fixNumber(num)
  return number ? `${prefix}-${region ?? ''}${number}` : null
}

/** `BROLEN062` as `BROL-EN062`. The number may run into following text, so shorter ones are tried. */
function parseUndashed(text: string): string | null {
  const m = UNDASHED.exec(text)
  if (!m) return null
  const [, prefix, num] = m
  for (let len = num.length; len >= 2; len--) {
    const number = fixNumber(num.slice(0, len))
    if (number) return `${prefix}-EN${number}`
  }
  return null
}

/**
 * parseSetCode first, then the same code with prefix zeros read as O, and with a prefix O next to
 * a digit read as zero (`BPO1` → `BP01`). If the number part starts with a letter that could be a
 * misread digit, the digit readings follow. Try them in order.
 */
export function setCodeCandidates(text: string): string[] {
  const code = parseSetCode(text)
  if (!code) return []
  const withPrefixAlt = (c: string): string[] => {
    const dash = c.indexOf('-')
    const prefix = c.slice(0, dash)
    const nearDigit = prefix.replace(/O(?=\d)|(?<=\d)O/g, '0')
    return [c, prefix.replace(/0/g, 'O') + c.slice(dash), nearDigit + c.slice(dash)]
  }
  const dash = code.indexOf('-')
  const rest = code.slice(dash + 1)
  const at = rest.startsWith('EN') ? 2 : 0
  const lead = DIGIT_FIX[rest[at]]
  const out = withPrefixAlt(code)
  if (lead) out.push(...withPrefixAlt(code.slice(0, dash + 1 + at) + lead + rest.slice(at + 1)))
  return [...new Set(out)]
}
