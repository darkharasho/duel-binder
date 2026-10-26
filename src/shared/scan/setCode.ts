export { setPrefix } from '../sets'

const CODE = /([A-Z0-9]{2,5})\s*[-–]\s*([A-Z]{2})?\s*([A-Z0-9]{2,4})/
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
 */
export function parseSetCode(text: string): string | null {
  const m = CODE.exec(text.toUpperCase())
  if (!m) return null
  const [, prefix, region, num] = m
  if (region && region !== 'EN') return null
  const number = fixNumber(num)
  return number ? `${prefix}-${region ?? ''}${number}` : null
}

/** parseSetCode first, then the same code with prefix zeros read as O. Try them in order. */
export function setCodeCandidates(text: string): string[] {
  const code = parseSetCode(text)
  if (!code) return []
  const dash = code.indexOf('-')
  const alt = code.slice(0, dash).replace(/0/g, 'O') + code.slice(dash)
  return alt === code ? [code] : [code, alt]
}
