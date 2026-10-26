export { setPrefix } from '../sets'

const DASHED = /([A-Z0-9]{2,5})\s*[-–]\s*(.*)/
const UNDASHED = /([A-Z0-9]{3,4})(EN|DE|FR|IT|SP|PT|JP|KR|AE|SC|TC|JA)([A-Z0-9]{2,4})/
/** Region letters in real set codes: current two-letter ones and the older single-letter ones. */
const REGIONS = new Set([
  ...['EN', 'DE', 'FR', 'IT', 'SP', 'PT', 'JP', 'KR', 'AE', 'SC', 'TC', 'JA'],
  ...['E', 'G', 'F', 'I', 'S', 'P', 'K']
])
const DIGIT_FIX: Record<string, string> = { O: '0', I: '1', L: '1', S: '5', B: '8', Z: '2' }

const toDigits = (s: string): string => s.replace(/[OILSBZ]/g, (c) => DIGIT_FIX[c])

/** The number part of a code, OCR-corrected; a single leading letter survives (e.g. `A01`). */
function fixNumber(num: string): string | null {
  const tail = toDigits(num.slice(1))
  if (/^[A-Z]/.test(num) && /^\d{2,3}$/.test(tail)) return num[0] + tail
  const all = toDigits(num)
  return /^\d{2,4}$/.test(all) ? all : null
}

interface Parts {
  prefix: string
  region: string
  number: string
}

/**
 * Splits OCR text into prefix, region and number. The region is the longest valid one (two
 * letters, then one) that leaves a readable number, so a misread digit after a one-letter region
 * (`LOB-EO01`) isn't taken as part of the region. A code with no region has an empty one.
 */
function parts(text: string): Parts | null {
  const upper = text.toUpperCase()
  const m = DASHED.exec(upper)
  if (!m) return parseUndashed(upper)
  const [, prefix, tail] = m
  for (const len of [2, 1, 0]) {
    const region = tail.slice(0, len)
    if (len > 0 && (!/^[A-Z]+$/.test(region) || !REGIONS.has(region))) continue
    const num = /^\s*([A-Z0-9]{2,4})/.exec(tail.slice(len))
    const number = num && fixNumber(num[1])
    if (number) return { prefix, region, number }
  }
  return null
}

/**
 * Normalizes OCR text to a `PREFIX-<region>nnn` set code in any printing region. A code with no
 * region (old Japanese `LOB-001`) comes back as `PREFIX-nnn`. OCR often drops the thin dash, so
 * `PREFIXDEnnn` (3–4 character prefix, two-letter region) parses too.
 */
export function parseSetCode(text: string): string | null {
  const p = parts(text)
  return p ? `${p.prefix}-${p.region}${p.number}` : null
}

/** `BROLEN062` as `BROL-EN062`. The number may run into following text, so shorter ones are tried. */
function parseUndashed(text: string): Parts | null {
  const m = UNDASHED.exec(text)
  if (!m || !/[A-Z]/.test(m[1])) return null
  const [, prefix, region, num] = m
  for (let len = num.length; len >= 2; len--) {
    const digits = toDigits(num.slice(0, len))
    if (/^\d{2,4}$/.test(digits)) return { prefix, region, number: digits }
  }
  return null
}

/**
 * parseSetCode first, then the same code with prefix zeros read as O, and with a prefix O next to
 * a digit read as zero (`BPO1` → `BP01`). If the number part starts with a letter that could be a
 * misread digit, the digit readings follow. Try them in order.
 */
export function setCodeCandidates(text: string): string[] {
  const p = parts(text)
  if (!p) return []
  const withPrefixAlt = (prefix: string, tail: string): string[] => {
    const nearDigit = prefix.replace(/O(?=\d)|(?<=\d)O/g, '0')
    return [prefix + tail, prefix.replace(/0/g, 'O') + tail, nearDigit + tail]
  }
  const lead = DIGIT_FIX[p.number[0]]
  const forms = (region: string): string[] => {
    const out = withPrefixAlt(p.prefix, `-${region}${p.number}`)
    if (lead) out.push(...withPrefixAlt(p.prefix, `-${region}${lead}${p.number.slice(1)}`))
    return out
  }
  // A regionless code is tried as written first (old Japanese codes), then as English.
  const out = p.region ? forms(p.region) : [...forms(''), ...forms('EN')]
  return [...new Set(out)]
}
