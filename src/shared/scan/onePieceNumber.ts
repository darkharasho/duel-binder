/** Typed One Piece card numbers ("op5-119", "OP05119") read as the printed form "OP05-119". */

const squash = (text: string): string => text.toUpperCase().replace(/\s+/g, '')

export function normalizeOpNumber(text: string): string | null {
  const t = squash(text)
  const m = /^([A-Z]{1,3})(\d{1,2})?-(\d{3})$/.exec(t) ?? /^([A-Z]{1,3})(\d{2})?(\d{3})$/.exec(t)
  if (!m) return null
  return `${m[1]}${m[2] === undefined ? '' : m[2].padStart(2, '0')}-${m[3]}`
}

/**
 * The set codes ("OP10-") a half-typed number could be heading for: nothing once there is a dash
 * or the three number digits.
 */
export function prefixSuggestions(typed: string, prefixes: readonly string[], max = 8): string[] {
  const t = squash(typed)
  if (t === '' || t.includes('-') || /\d{3}$/.test(t)) return []
  return prefixes
    .filter((p) => p.startsWith(t))
    .slice(0, max)
    .map((p) => `${p}-`)
}

// ---- Numbers read off the camera ----

/**
 * Characters tesseract mixes up in this font, small and soft: the letters a digit may have been
 * (the set code's), and the digit a letter may have been (the set's and the card's number).
 */
const AS_LETTERS: Record<string, string> = {
  '0': 'OD',
  '1': 'IT',
  '2': 'Z',
  '5': 'S',
  '7': 'T',
  '8': 'BS'
}
const AS_LETTER: Record<string, string> = { '0': 'O', '1': 'I', '2': 'Z', '5': 'S', '8': 'B' }
const AS_DIGIT: Record<string, string> = { O: '0', D: '0', I: '1', Z: '2', S: '5', B: '8' }

const isDigit = (c: string | undefined): boolean => c !== undefined && c >= '0' && c <= '9'
const asDigit = (c: string | undefined): string | null =>
  c === undefined ? null : isDigit(c) ? c : (AS_DIGIT[c] ?? null)

/** The set codes Bandai prints, for when the catalog's own list isn't to hand. */
const FAMILY_RE = /^(?:(?:OP|ST|EB|PRB)\d{2}|P)$/

/** Whether `read` (OCR text) can be `code`, with a letter or digit read as its lookalike. */
function readsAs(read: string, code: string): boolean {
  if (read.length !== code.length) return false
  for (let i = 0; i < code.length; i++) {
    const want = code[i]
    const got = read[i]
    if (got === want) continue
    if (isDigit(want) ? AS_DIGIT[got] !== want : !AS_LETTERS[got]?.includes(want)) return false
  }
  return true
}

/** The set codes that the text from `at` on could start with, longest first ("PRB01" before "P"). */
function codesAt(t: string, at: number, prefixes: readonly string[] | undefined): string[] {
  const out: string[] = []
  if (prefixes) {
    for (const p of prefixes) if (readsAs(t.slice(at, at + p.length), p)) out.push(p)
  } else {
    for (const len of [5, 4, 1]) {
      const raw = t.slice(at, at + len)
      if (raw.length < len) continue
      // Letters where a family has letters, digits where it has its two set digits.
      const code = [...raw]
        .map((c, i) => (len > 1 && i >= len - 2 ? (asDigit(c) ?? c) : (AS_LETTER[c] ?? c)))
        .join('')
      if (FAMILY_RE.test(code)) out.push(code)
    }
  }
  // Not one that starts mid-way through a longer code: in "0P-119" (OP05-119 with its set digits
  // lost), the "P" follows an O, so it isn't promo P-119.
  const prev = t.slice(Math.max(0, at - 1), at)
  const longer = prefixes ?? ['OP00', 'ST00', 'EB00', 'PRB00']
  const midway = (code: string): boolean =>
    prev !== '' &&
    longer.some((p) => p.length > code.length && readsAs(prev + code, p.slice(0, code.length + 1)))
  return out.filter((c) => !midway(c)).sort((a, b) => b.length - a.length)
}

/**
 * Every One Piece number in a line read off a card's number band ("OP05-119SEC2": the number, its
 * rarity box and block icon), in the printed form and once each. The set code must be one of
 * `prefixes` (the catalog's, e.g. "OP05", "P") or, without them, one of Bandai's set families.
 * A lookalike letter or digit is taken for the one the number needs ("0P05-1I9"). With no dash,
 * the three digits must be real ones, and the line mustn't run on with a fourth.
 */
export function findOpNumbers(text: string, prefixes?: readonly string[]): string[] {
  const t = text.toUpperCase().replace(/[^A-Z0-9-]/g, '')
  const out = new Set<string>()
  for (let at = 0; at < t.length; at++) {
    for (const code of codesAt(t, at, prefixes)) {
      const rest = t.slice(at + code.length)
      let digits: (string | null)[]
      if (rest[0] === '-') digits = [...rest.slice(1, 4)].map(asDigit)
      else if (isDigit(rest[0]) && isDigit(rest[1]) && isDigit(rest[2]) && !isDigit(rest[3]))
        digits = [...rest.slice(0, 3)]
      else continue
      if (digits.length !== 3 || digits.some((d) => d === null)) continue
      const number = normalizeOpNumber(`${code}-${digits.join('')}`)
      if (number) out.add(number)
      break
    }
  }
  return [...out]
}

/** A frame's number: the one number its bands read, or null for none or more than one. */
export function frameNumber(texts: readonly string[], prefixes?: readonly string[]): string | null {
  const found = new Set(texts.flatMap((t) => findOpNumbers(t, prefixes)))
  return found.size === 1 ? [...found][0] : null
}

/**
 * A number read off the camera is trusted once it reads on `need` tries in a row: a try that
 * reads nothing, or another number, starts the count over.
 */
export function createNumberGate(need = 2): {
  /** The try's read; the number once it has read `need` times running, else null. */
  push(read: string | null): string | null
  reset(): void
} {
  let last: string | null = null
  let streak = 0
  return {
    push(read) {
      if (read !== null && read === last) streak++
      else {
        last = read
        streak = read === null ? 0 : 1
      }
      return read !== null && streak >= need ? read : null
    },
    reset() {
      last = null
      streak = 0
    }
  }
}
