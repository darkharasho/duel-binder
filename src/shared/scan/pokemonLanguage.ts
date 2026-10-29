import { latinLanguageOf } from './language'
import {
  LANGUAGE_MIN_LATIN_CHARS,
  LANGUAGE_MIN_SCRIPT_CHARS,
  LANGUAGE_MIN_WORDS
} from './thresholds'

// Kana without the long-vowel mark and middle dot, which a model reads rules and dashes as.
const KANA = /[ぁ-ゖァ-ヺ]/u
/** Katakana a model reads kanji as (口 as ロ, 力 as カ, 工 as エ, ...), so they say nothing of Japanese. */
const LOOKALIKES = new Set([...'ロカエタトニハヘノム'])
const HAN = /[一-鿿]/u
const HANGUL = /[가-힯]/u
const LATIN = /[a-z]/i
const DASHES = new Set(['一', 'ー'])

/**
 * Words on English Pokémon cards and in their text, beyond latinLanguageOf's. Pokémon, Trainer
 * and Resistance are left out: European cards print them too (Résistance once its accent is
 * dropped).
 */
const ENGLISH = new Set(
  "weakness retreat basic stage evolves energy damage attack opponent's your this ability".split(
    ' '
  )
)

/** The English Pokémon card words in a read, counted as often as they come. */
const englishWords = (text: string): number =>
  (text.toLowerCase().match(/[a-z']+/g) ?? []).filter((w) => ENGLISH.has(w)).length

/**
 * The language a read of a Pokémon card's text is in, of those the catalog has.
 *
 * - `ja`: LANGUAGE_MIN_SCRIPT_CHARS of kana (not counting katakana that look like kanji), at
 *   least a quarter of the CJK text, which is most of the letters. Chinese has no kana.
 * - `other`: any other CJK or Hangul text that much, and a Latin language whose common words
 *   say it isn't English.
 * - `en`: LANGUAGE_MIN_LATIN_CHARS of mostly Latin letters, with English words in them
 *   (LANGUAGE_MIN_WORDS of them); European cards share the names and the numbers.
 * - null: too little to tell.
 */
export function pokemonLanguage(text: string): 'en' | 'ja' | 'other' | null {
  const letters = [...text].filter((c) => /\p{L}/u.test(c) && !DASHES.has(c))
  const count = (test: (c: string) => boolean): number => letters.filter(test).length
  const kana = count((c) => KANA.test(c) && !LOOKALIKES.has(c))
  const cjk = count((c) => KANA.test(c) || HAN.test(c))
  const hangul = count((c) => HANGUL.test(c))
  const latin = count((c) => LATIN.test(c))
  if (kana >= LANGUAGE_MIN_SCRIPT_CHARS && !hangul && kana * 4 >= cjk && cjk * 2 > letters.length)
    return 'ja'
  if (cjk + hangul >= LANGUAGE_MIN_SCRIPT_CHARS) return 'other'
  if (latin < LANGUAGE_MIN_LATIN_CHARS || latin * 2 <= letters.length) return null
  const words = latinLanguageOf(text)
  if (words) return words === 'en' ? 'en' : 'other'
  return englishWords(text) >= LANGUAGE_MIN_WORDS ? 'en' : null
}
