import type { Language } from '../languages'

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

/** A Magic info line's read: the code as normalizeMagicCode writes it, the language and finish. */
export interface MagicCodeRead {
  /** "FRA 81" */
  code: string
  /** From the printed tag, which a read needs. */
  language: Language
  /** The star (foil) or dot (not) between set and language; null when neither reads. */
  foil: boolean | null
}

/** A card's printed language tag, with the ways it is also written or read. */
const LANGUAGE_TAGS: Record<string, Language> = {
  EN: 'en',
  DE: 'de',
  FR: 'fr',
  IT: 'it',
  ES: 'es',
  SP: 'es',
  PT: 'pt',
  RU: 'ru',
  JP: 'ja',
  JA: 'ja',
  KR: 'ko',
  KO: 'ko',
  CS: 'zh-hans',
  SC: 'zh-hans',
  CT: 'zh-hant',
  TC: 'zh-hant'
}

const RARITY = '[CURMSLTP]'
/** A number's digits as OCR gives them, letters for look-alike digits included. */
const DIGITS = '[0-9OoDQIl|!SBZ]{1,4}'
const SET = '[A-Z0-9]{3,5}'
/** The dot or star between set and language; OCR reads either as "+" too. */
const SEP = '[•★*·.+\\-]'
const NUMBER_FIXES: Record<string, string> = {
  O: '0',
  o: '0',
  D: '0',
  Q: '0',
  I: '1',
  l: '1',
  '|': '1',
  '!': '1',
  S: '5',
  B: '8',
  Z: '2'
}
/** Set codes mix letters and digits ("MH3", "9ED"): each look-alike is tried the other way too. */
const SET_SWAPS: Record<string, string> = { '0': 'O', O: '0', '1': 'I', I: '1', '5': 'S', S: '5', '8': 'B', B: '8' }

// "C 0081 FRA • EN" (2023 on) and "078/279 C XLN • EN" (2015-2022), lines joined. The language
// tag is required: without it, real photos' junk ("TIO TIE", "CBI JST WH") reads as codes.
const RARITY_FIRST = new RegExp(
  `(?:^|\\s)${RARITY}\\s*(${DIGITS})\\s+(${SET})\\s*(${SEP})?\\s*([A-Z]{2})(?=\\s|$)`,
  'gu'
)
const NUMBER_FIRST = new RegExp(
  `(?:^|\\s)(${DIGITS})\\s*/\\s*${DIGITS}\\s*(?:${RARITY})?\\s+(${SET})\\s*(${SEP})?\\s*([A-Z]{2})(?=\\s|$)`,
  'gu'
)

const setVariants = (set: string): string[] => {
  const out = [set]
  for (let i = 0; i < set.length; i++) {
    const swap = SET_SWAPS[set[i]]
    if (swap) out.push(set.slice(0, i) + swap + set.slice(i + 1))
  }
  return out
}

/**
 * The Magic codes a frame's code band reads (`codeTexts`, one text per band, a line or two each),
 * best first: every info line found, in both layouts ("C 0081" over "FRA • EN", and "078/279 C"
 * over "XLN • EN"), each band alone and then all of them together; look-alike letters in the
 * number taken as digits, and the set code also tried with each look-alike swapped. A read needs
 * the language tag; empty when no info line reads. The caller keeps the first the catalog knows.
 */
export function frameMagicCode(codeTexts: string[]): MagicCodeRead[] {
  const texts = codeTexts.map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean)
  if (texts.length > 1) texts.push(texts.join(' '))
  const out: MagicCodeRead[] = []
  const seen = new Set<string>()
  for (const text of texts) {
    // Upper case outside the number, whose lower-case look-alikes ("o", "l") are mended below.
    const upper = text.replace(/[a-km-np-z]/g, (c) => c.toUpperCase())
    for (const re of [RARITY_FIRST, NUMBER_FIRST]) {
      for (const m of upper.matchAll(re)) {
        const [, rawNumber, set, sep, tag] = m
        const digits = [...rawNumber].map((c) => NUMBER_FIXES[c] ?? c).join('')
        if (!/^\d+$/.test(digits)) continue
        const language = LANGUAGE_TAGS[tag]
        if (!language) continue
        const foil = sep === undefined || sep === '+' ? null : sep === '★' || sep === '*'
        for (const s of setVariants(set)) {
          const code = normalizeMagicCode(`${s} ${digits}`)
          if (!code || seen.has(code)) continue
          seen.add(code)
          out.push({ code, language, foil })
        }
      }
    }
  }
  return out
}
