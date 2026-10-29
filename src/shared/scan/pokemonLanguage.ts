import { latinLanguageOf } from './language'
import {
  LANGUAGE_MIN_JA_WORDS,
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
  (
    "weakness retreat basic stage evolves energy damage attack opponent's your this ability " +
    // The words of attacks' text, as a blurred read keeps them ("opponent's" as "opponents").
    'opponents flip coin coins heads tails during prevent discard attached attacks effects ' +
    'next turn more less does done takes benched active nothing paralyzed poisoned confused ' +
    'asleep burned shuffle remaining'
  ).split(' ')
)

/**
 * The English words a read may get one letter wrong in and still count ("oppanent's"): long
 * ones no European card word comes within a letter of. Attack(s), active and energy are left
 * out: German Attacke, Spanish activo and energía are a letter or two off.
 */
const FUZZY = [
  "opponent's",
  'opponent',
  'opponents',
  'damage',
  'during',
  'prevent',
  'discard',
  'attached',
  'weakness',
  'retreat',
  'benched',
  'effects',
  'nothing',
  'paralyzed',
  'poisoned',
  'confused',
  'shuffle',
  'remaining'
]

/** Whether a and b are at most one letter added, dropped or changed apart. */
function oneOff(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  const [x, y] = [a.slice(i), b.slice(i)]
  return x.slice(1) === y.slice(1) || x.slice(1) === y || x === y.slice(1)
}

const englishWord = (w: string): boolean =>
  ENGLISH.has(w) || (w.length >= 6 && FUZZY.some((f) => oneOff(w, f)))

/**
 * Words of Japanese Pokémon card text, written in kana as Chinese never is, three kana or more so
 * the Japanese model's kana-like noise doesn't make them by chance. Kept as japaneseWords
 * compares them: without dakuten, which a blurred read drops (ダメージ as タメーシ).
 */
const JAPANESE =
  'ポケモン ダメージ エネルギー トラッシュ コイン オモテ バトル ベンチ にげる グッズ サポート スタジアム ターン カード こんらん ねむり やけど'
    .split(' ')
    .map((w) => plainKana(w))

/** Kana without dakuten and handakuten, and a kanji one read for the long-vowel mark as that mark. */
function plainKana(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u3099\u309a]/gu, '')
    .normalize('NFC')
    .replace(/一/gu, 'ー')
}

/** The Japanese Pokémon card words in a read, counted as often as they come; spaces left out. */
function japaneseWords(text: string): number {
  const plain = plainKana(text.replace(/\s+/gu, ''))
  let n = 0
  for (const w of JAPANESE) n += plain.split(w).length - 1
  return n
}

/** The English Pokémon card words in a read, counted as often as they come. */
const englishWords = (text: string): number =>
  (
    text
      .toLowerCase()
      .replace(/’/g, "'")
      .match(/[a-z']+/g) ?? []
  ).filter(englishWord).length

/**
 * The language a read of a Pokémon card's text is in, of those the catalog has.
 *
 * - `ja`: LANGUAGE_MIN_SCRIPT_CHARS of kana (not counting katakana that look like kanji), at
 *   least a quarter of the CJK text, which is most of the letters, with LANGUAGE_MIN_JA_WORDS
 *   Japanese card words in it (kana alone may be noise; null then). Chinese has no kana.
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
    return japaneseWords(text) >= LANGUAGE_MIN_JA_WORDS ? 'ja' : null
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

/**
 * A Pokémon card's language from its text bands (the same text cut out in different ways), each
 * read once per model and judged on its own (pokemonLanguageOfReads): other when any band says
 * so, else the one language some band tells and none contradicts; null when none tells.
 */
export function pokemonLanguageOfBands(reads: {
  eng: string[]
  jpn: string[]
}): 'en' | 'ja' | 'other' | null {
  const told = reads.eng.map((eng, i) => pokemonLanguageOfReads({ eng, jpn: reads.jpn[i] ?? '' }))
  if (told.includes('other')) return 'other'
  const ja = told.includes('ja')
  const en = told.includes('en')
  return ja === en ? null : ja ? 'ja' : 'en'
}
