import { latinLanguageOf } from './language'
import { normalizeName } from './names'
import {
  EN_NAME_FUZZIER_LENGTH,
  EN_NAME_FUZZY_LENGTH,
  EN_NAME_MIN_LENGTH,
  JA_NAME_FUZZY_LENGTH,
  JA_NAME_MIN_LENGTH,
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
 * Words latinLanguageOf isn't shown: short ones and ones in capitals, which a model's garbage of
 * a blurred text box is full of ("EE TE SE ER LE" reads as French), where a card's own text is
 * in lower case with long words enough to tell.
 */
const SHORT_OR_CAPS = /(?<!\p{L})(?:\p{L}{1,2}|\p{Lu}{3,})(?!\p{L})/gu

/**
 * The language a read of a Pokémon card's text is in, of those the catalog has.
 *
 * - `ja`: LANGUAGE_MIN_SCRIPT_CHARS of kana (not counting katakana that look like kanji), at
 *   least a quarter of the CJK text, which is most of the letters, with LANGUAGE_MIN_JA_WORDS
 *   Japanese card words in it (kana alone may be noise; null then). Chinese has no kana.
 * - `other`: any other CJK or Hangul text that much, and a Latin language whose common words
 *   say it isn't English.
 * - `en`: LANGUAGE_MIN_LATIN_CHARS of mostly Latin letters, with English words in them
 *   (LANGUAGE_MIN_WORDS of them, one an English Pokémon card's); European cards share the names
 *   and the numbers.
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
  // Its short common words ("of", "to") come up by chance in garbage the English model makes of
  // Japanese text, so English needs a Pokémon card's word too.
  if (words === 'en') return englishWords(text) ? 'en' : null
  // A European language is told by its longer words alone.
  const european = latinLanguageOf(text.replace(SHORT_OR_CAPS, ' '))
  if (european && european !== 'en') return 'other'
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

/** Small kana a blurred read takes for their full-size forms (ュ as ユ). */
const SMALL_KANA: Record<string, string> = Object.fromEntries(
  [...'ァィゥェォッャュョヮ'].map((c) => [c, String.fromCodePoint(c.codePointAt(0)! + 1)])
)

/** A name's letters as readsJapaneseName compares them: kana and kanji, without dakuten, small kana as full-size. */
function japaneseNameKey(text: string): string {
  return plainKana(text)
    .replace(/[ァ-ヺ]/gu, (c) => SMALL_KANA[c] ?? c)
    .replace(/[^ぁ-ゖァ-ヺー一-鿿]/gu, '')
}

/** The fewest letters key differs in from any stretch of text (an approximate substring match). */
function nearestStretch(text: string, key: string): number {
  // Row per key letter: the cost of matching key so far, ending at each text position.
  let prev = new Array<number>(text.length + 1).fill(0)
  for (let i = 1; i <= key.length; i++) {
    const cur = [i]
    for (let j = 1; j <= text.length; j++)
      cur.push(
        Math.min(prev[j - 1] + (key[i - 1] === text[j - 1] ? 0 : 1), prev[j] + 1, cur[j - 1] + 1)
      )
    prev = cur
  }
  return Math.min(...prev)
}

/**
 * Whether a Japanese-model read of a card's name band shows name, a Japanese card's printed
 * name: its kana and kanji (a suffix in Latin letters like ex is left to the art) somewhere in
 * the read, one letter off in a name of JA_NAME_FUZZY_LENGTH letters or more. A name needs
 * JA_NAME_MIN_LENGTH letters and some kana: Chinese prints no kana, so a Chinese twin's name,
 * all Han, never reads as a Japanese one.
 */
export function readsJapaneseName(read: string, name: string): boolean {
  const key = japaneseNameKey(name)
  if (key.length < JA_NAME_MIN_LENGTH || !KANA.test(key)) return false
  const text = japaneseNameKey(read)
  if (!text) return false
  return nearestStretch(text, key) <= (key.length >= JA_NAME_FUZZY_LENGTH ? 1 : 0)
}

/**
 * Whether an English-model read of a card's name band shows name, an English card's name: its
 * letters and digits somewhere in the read, one letter off in a name of EN_NAME_FUZZY_LENGTH or
 * more and two in one of EN_NAME_FUZZIER_LENGTH. A name needs EN_NAME_MIN_LENGTH of them, so
 * a short one isn't made by chance.
 */
export function readsEnglishName(read: string, name: string): boolean {
  const key = normalizeName(name)
  if (key.length < EN_NAME_MIN_LENGTH) return false
  const text = normalizeName(read)
  if (!text) return false
  const off = key.length >= EN_NAME_FUZZIER_LENGTH ? 2 : key.length >= EN_NAME_FUZZY_LENGTH ? 1 : 0
  return nearestStretch(text, key) <= off
}
