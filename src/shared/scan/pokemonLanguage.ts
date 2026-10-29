import { latinLanguageOf } from './language'
import { LANGUAGE_MIN_LATIN_CHARS, LANGUAGE_MIN_SCRIPT_CHARS } from './thresholds'

// Kana without the long-vowel mark and middle dot, which a model reads rules and dashes as.
const KANA = /[ぁ-ゖァ-ヺ]/u
const HAN = /[一-鿿]/u
const HANGUL = /[가-힯]/u
const LATIN = /[a-z]/i
const DASHES = new Set(['一', 'ー'])

/**
 * The language a read of a Pokémon card's text is in, of those the catalog has: `ja` when it is
 * mostly Japanese with LANGUAGE_MIN_SCRIPT_CHARS of kana (Chinese has none); `other` for any
 * other CJK or Hangul text that much, and for a Latin language whose common words say it isn't
 * English; `en` for LANGUAGE_MIN_LATIN_CHARS of mostly Latin letters; null when there's too
 * little text to tell.
 */
export function pokemonLanguage(text: string): 'en' | 'ja' | 'other' | null {
  const letters = [...text].filter((c) => /\p{L}/u.test(c) && !DASHES.has(c))
  const count = (re: RegExp): number => letters.filter((c) => re.test(c)).length
  const [kana, han, hangul, latin] = [count(KANA), count(HAN), count(HANGUL), count(LATIN)]
  if (kana >= LANGUAGE_MIN_SCRIPT_CHARS && !hangul && (kana + han) * 2 > letters.length) return 'ja'
  if (kana + han + hangul >= LANGUAGE_MIN_SCRIPT_CHARS) return 'other'
  if (latin < LANGUAGE_MIN_LATIN_CHARS || latin * 2 <= letters.length) return null
  const words = latinLanguageOf(text)
  return words && words !== 'en' ? 'other' : 'en'
}
