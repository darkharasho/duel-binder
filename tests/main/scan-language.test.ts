import { describe, expect, it, vi } from 'vitest'
import { latinLanguageOf, scriptOf, type ScriptRead } from '../../src/shared/scan/language'
import { cardLanguage } from '../../src/shared/scan/cardLanguage'
import type { Ocr, OcrModel } from '../../src/shared/scan/ocr'
import type { OcrBand } from '../../src/shared/scan/types'

describe('latinLanguageOf', () => {
  it.each([
    [
      'en',
      'If this card is Normal Summoned: You can add 1 "Dark Magician" from your Deck to your hand. You can only use this effect of this card once per turn.'
    ],
    [
      'de',
      'Wenn diese Karte als Normalbeschwörung beschworen wird: Du kannst 1 „Dunkler Magier“ von deinem Deck deiner Hand hinzufügen. Du kannst diesen Effekt von dieser Karte nur einmal pro Spielzug verwenden.'
    ],
    [
      'fr',
      "Si cette carte est Invoquée Normalement : vous pouvez ajouter 1 « Magicien Sombre » depuis votre Deck à votre main. Vous ne pouvez utiliser cet effet de cette carte qu'une fois par tour."
    ],
    [
      'it',
      'Se questa carta viene Evocata Normalmente: puoi aggiungere alla tua mano 1 "Mago Nero" dal tuo Deck. Puoi utilizzare questo effetto di questa carta una sola volta per turno.'
    ],
    [
      'es',
      'Si esta carta es Invocada de Modo Normal: puedes añadir a tu mano 1 "Mago Oscuro" de tu Deck. Sólo puedes usar este efecto de esta carta una vez por turno.'
    ],
    [
      'pt',
      'Se este card for Invocado-Normal: você pode adicionar 1 "Mago Negro" do seu Deck à sua mão. Você só pode usar este efeito deste card uma vez por turno.'
    ]
  ])('tells %s card text', (language, text) => {
    expect(latinLanguageOf(text)).toBe(language)
  })

  it('tells English through an OCR read of a small photo', () => {
    // A real read of a sleeved card's text box.
    const read =
      'you control "Dark Mogicoian” Specml Swomm | Dark Magtoun fel” Trom peur hand, Deck, or GY. then you cain Sot 1 Dark Mame'
    expect(latinLanguageOf(read)).toBe('en')
  })

  it('tells nothing from a garbled read or too few words', () => {
    expect(
      latinLanguageOf('eoas-sWBlArsHAedeRBo Fondo Rb 2 Rai sana i LoCH ERR re pi sas tad')
    ).toBeNull()
    expect(latinLanguageOf('ATK/3500 DEF/2600 1st Edition')).toBeNull()
    expect(latinLanguageOf('')).toBeNull()
  })

  it('tells nothing when two languages read about as well', () => {
    expect(latinLanguageOf('la carta de la mano')).toBeNull()
  })
})

const read = (language: ScriptRead['language'], confidence: number, text = ''): ScriptRead => ({
  language,
  text,
  confidence
})
const KANA = 'モンスターを特殊召喚する。このカードを手札から'

describe('scriptOf', () => {
  it('takes the clearly most confident read in its own script', () => {
    expect(scriptOf([read('en', 17), read('ja', 32, KANA), read('ko', 16), read('zh', 18)])).toBe(
      'ja'
    )
    expect(
      scriptOf([
        read('en', 20),
        read('ja', 25),
        read('ko', 39, '사이버스족 링크 효과 몬스터'),
        read('zh', 22)
      ])
    ).toBe('ko')
  })

  it('is unsure when the best read is not confident or not clearly best', () => {
    expect(scriptOf([read('en', 17), read('ja', 26, KANA)])).toBeNull()
    expect(scriptOf([read('en', 30), read('ja', 33, KANA)])).toBeNull()
    expect(scriptOf([])).toBeNull()
  })

  it('does not take Latin letters, or rules read as dashes, for Chinese', () => {
    // A real read of an English card's bottom edge with the Chinese model.
    const text =
      '四\nYATK/3500 DT/2600\nav0702 Js Editinn W Ron UsAWUESNA TY TD 村 江 AAl| 本 罗\n一 一 一 一 一 一'
    expect(scriptOf([read('en', 24), read('ja', 34), read('zh', 44, text)])).toBeNull()
  })

  it('wants kana for Japanese, since Chinese has none', () => {
    expect(scriptOf([read('en', 10), read('ja', 40, '特殊召喚手札効果')])).toBeNull()
  })

  it('names English when it reads clearly best', () => {
    expect(scriptOf([read('en', 55), read('ja', 28, KANA)])).toBe('en')
  })
})

describe('cardLanguage', () => {
  const band = (width: number): OcrBand => ({ width, height: 1, data: new Uint8Array(width) })
  const fakeOcr = (
    reads: Partial<Record<OcrModel, { text: string; confidence: number }>>
  ): Ocr => ({
    read: vi.fn(),
    readText: vi.fn(
      async (_band: OcrBand, model: OcrModel) => reads[model] ?? { text: '', confidence: 0 }
    ),
    dispose: vi.fn()
  })

  it('stops at the English read when its words tell the language', async () => {
    const ocr = fakeOcr({ eng: { text: 'Du kannst diese Karte von deinem Deck', confidence: 60 } })
    expect(await cardLanguage(ocr, [band(5)])).toBe('de')
    expect(ocr.readText).toHaveBeenCalledTimes(1)
  })

  it('reads each script when the English read tells nothing', async () => {
    const ocr = fakeOcr({
      eng: { text: 'eoas sWBl', confidence: 17 },
      jpn: { text: KANA, confidence: 33 }
    })
    expect(await cardLanguage(ocr, [band(5)])).toBe('ja')
    expect(vi.mocked(ocr.readText).mock.calls.map(([, m]) => m)).toEqual([
      'eng',
      'jpn',
      'kor',
      'chi_sim'
    ])
  })

  it('tries the next band, the card the other way up, and skips empty ones', async () => {
    const ocr = fakeOcr({})
    vi.mocked(ocr.readText).mockImplementation(async (b) =>
      b.width === 6
        ? { text: 'you can add this card from your hand', confidence: 70 }
        : { text: '', confidence: 0 }
    )
    expect(
      await cardLanguage(ocr, [{ width: 0, height: 0, data: new Uint8Array(0) }, band(5), band(6)])
    ).toBe('en')
  })

  it('gives null when Latin text has too few words to tell its language', async () => {
    const ocr = fakeOcr({ eng: { text: 'ATK/3500 DEF/2600', confidence: 80 } })
    expect(await cardLanguage(ocr, [band(5)])).toBeNull()
  })
})
