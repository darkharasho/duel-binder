import {
  latinLanguageOf,
  scriptOf,
  type CardLanguage,
  type ScriptRead
} from './language'
import type { OcrBand } from './types'
import type { Ocr, OcrModel } from './ocr'

const SCRIPTS: [Exclude<ScriptRead['language'], 'en'>, OcrModel][] = [
  ['ja', 'jpn'],
  ['ko', 'kor'],
  ['zh', 'chi_sim']
]

/**
 * The language of the card text on the first band it can be told from. A read in English that
 * has enough of one Latin language's common words names that language. Otherwise the band is
 * read with each script's model too, and the script that reads clearly best names it; a Latin
 * script without the words to tell which language is no answer. Null when no band tells.
 */
export async function cardLanguage(ocr: Ocr, bands: OcrBand[]): Promise<CardLanguage | null> {
  for (const band of bands) {
    if (!band.width || !band.height) continue
    const english = await ocr.readText(band, 'eng')
    const latin = latinLanguageOf(english.text)
    if (latin) return latin
    const reads: ScriptRead[] = [{ language: 'en', ...english }]
    for (const [language, model] of SCRIPTS)
      reads.push({ language, ...(await ocr.readText(band, model)) })
    const script = scriptOf(reads)
    if (script && script !== 'en') return script
  }
  return null
}
