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

/**
 * A Japanese-model read as pokemonLanguage judges it, but one mostly in Latin letters is judged
 * on those alone: the model reads an English card's text as English with stray kana and kanji
 * among it, which say nothing of the card's script. A European card's read still says other by
 * its words.
 */
function jpnLanguage(text: string): 'en' | 'ja' | 'other' | null {
  const letters = [...text].filter((c) => /\p{L}/u.test(c) && !DASHES.has(c))
  const latin = letters.filter((c) => LATIN.test(c)).length
  if (latin * 2 <= letters.length) return pokemonLanguage(text)
  return pokemonLanguage([...text].filter((c) => !/\p{L}/u.test(c) || LATIN.test(c)).join(''))
}

/**
 * A Pokémon card's language from its text read once per model. Each read is judged on its own:
 * run together, the Japanese model's kana-like garbage on an English card would make it Japanese.
 *
 * - `other` when either read says other (Chinese, Korean, a European language); a Japanese-model
 *   read mostly in Latin letters is judged on those alone (jpnLanguage).
 * - `ja` when the Japanese model's read says ja and the English one's doesn't say en.
 * - `en` when the English model's read says en and the Japanese one's doesn't say ja.
 * - null otherwise: the reads disagree, or neither tells.
 */
export function pokemonLanguageOfReads(reads: {
  eng: string
  jpn: string
}): 'en' | 'ja' | 'other' | null {
  const eng = pokemonLanguage(reads.eng)
  const jpn = jpnLanguage(reads.jpn)
  if (eng === 'other' || jpn === 'other') return 'other'
  if (jpn === 'ja' && eng !== 'en') return 'ja'
  if (eng === 'en' && jpn !== 'ja') return 'en'
  return null
}
