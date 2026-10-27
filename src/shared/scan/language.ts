import {
  LANGUAGE_MIN_CONFIDENCE,
  LANGUAGE_MIN_MARGIN,
  LANGUAGE_MIN_SCRIPT_CHARS,
  LANGUAGE_MIN_WORDS
} from './thresholds'

/**
 * Words common in card text, by language. A word several languages share counts for each of
 * them, split between them, so the words only one language uses decide.
 */
const WORDS: Partial<Record<CardLanguage, string>> = {
  en:
    'the you your this card cards from can and monster monsters of to if or its when by that ' +
    'opponent deck hand field target once per turn control special summon destroy then effect',
  de:
    'der die das und du deine deinen deinem deiner dein diese dieser diesen karte karten von ' +
    'kannst auf eine einen ein zu mit monster wenn nicht sie dem den des deck gegner gegners zug ' +
    'spielzug spielfeld hand oder effekt',
  fr:
    'le la les de des du vous votre vos cette carte cartes et un une ce au aux monstre ' +
    'monstres pouvez adversaire tour main terrain si est sur en ou puis effet',
  it:
    'il la le di del della dei puoi questa carta carte tuo tua tuoi un una mostro mostri ' +
    'avversario turno mano terreno se che per da nel nella poi effetto',
  es:
    'el la los las de del puedes esta carta cartas tu tus un una monstruo monstruos ' +
    'adversario turno mano campo si que por en se luego efecto',
  pt:
    'os as de do da dos das voce pode este esta carta cartas seu sua seus um uma monstro ' +
    'monstros oponente turno mao campo se que por no na em depois efeito deste'
}

/** How much each word counts for each language that uses it. */
const WEIGHTS = new Map<string, { language: CardLanguage; weight: number }[]>()
for (const [language, words] of Object.entries(WORDS) as [CardLanguage, string][]) {
  for (const w of words.split(' '))
    WEIGHTS.set(w, [...(WEIGHTS.get(w) ?? []), { language, weight: 0 }])
}
for (const uses of WEIGHTS.values()) for (const u of uses) u.weight = 1 / uses.length

/** Lower case with accents dropped, as an English reader turns "você" into "voce". */
const plain = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

/**
 * The Latin-script language whose common words a read of the card's text has most of, when it
 * has at least LANGUAGE_MIN_WORDS of them and half again as many as any other; else null.
 */
export function latinLanguageOf(text: string): CardLanguage | null {
  const scores = new Map<CardLanguage, number>()
  for (const word of plain(text).match(/[a-z]+/g) ?? []) {
    for (const { language, weight } of WEIGHTS.get(word) ?? [])
      scores.set(language, (scores.get(language) ?? 0) + weight)
  }
  const [best, next] = [...scores].sort((a, b) => b[1] - a[1])
  if (!best || best[1] < LANGUAGE_MIN_WORDS) return null
  return next && next[1] * 1.5 > best[1] ? null : best[0]
}

/** One read of the card's text with one script's model; confidence is tesseract's, 0-100. */
export interface ScriptRead {
  language: 'en' | 'ja' | 'ko' | 'zh'
  text: string
  confidence: number
}

/** Each script's own characters; Japanese is written in kana with kanji. */
const SCRIPT: Record<Exclude<ScriptRead['language'], 'en'>, RegExp> = {
  ja: /[\u3040-\u30ff\u4e00-\u9fff]/u,
  ko: /[\uac00-\ud7af]/u,
  zh: /[\u4e00-\u9fff]/u
}
const KANA = /[\u3040-\u30ff]/u
/** A model reads rules and dashes as these, so they say nothing of the script. */
const DASHES = new Set(['一', 'ー'])

/**
 * Whether a read with a non-Latin script's model shows that script: LANGUAGE_MIN_SCRIPT_CHARS of
 * its characters (of kana, for Japanese, as Chinese has no kana), making up most of its letters.
 */
function showsScript(read: ScriptRead & { language: keyof typeof SCRIPT }): boolean {
  const letters = [...read.text].filter((c) => /\p{L}/u.test(c) && !DASHES.has(c))
  const own = letters.filter((c) => SCRIPT[read.language].test(c))
  const marks = read.language === 'ja' ? own.filter((c) => KANA.test(c)) : own
  return marks.length >= LANGUAGE_MIN_SCRIPT_CHARS && own.length * 2 > letters.length
}

/**
 * The script a card's text is in, from reads of it with each script's model: the most confident
 * read, when it is at least LANGUAGE_MIN_CONFIDENCE, beats every other by LANGUAGE_MIN_MARGIN and
 * (but for English) is mostly its own script. Chinese is 'zh' for either form. Null when no read
 * stands out, as when the text is too small to read.
 */
export function scriptOf(reads: ScriptRead[]): ScriptRead['language'] | null {
  const [best, ...rest] = [...reads].sort((a, b) => b.confidence - a.confidence)
  if (!best || best.confidence < LANGUAGE_MIN_CONFIDENCE) return null
  if (rest.some((r) => best.confidence - r.confidence < LANGUAGE_MIN_MARGIN)) return null
  if (best.language === 'en') return 'en'
  return showsScript({ ...best, language: best.language }) ? best.language : null
}

/** The language a card's text reads as; Chinese is 'zh' for either form. */
export type CardLanguage = 'en' | 'de' | 'fr' | 'it' | 'es' | 'pt' | 'ja' | 'ko' | 'zh'
