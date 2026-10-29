import { describe, expect, it } from 'vitest'
import { pokemonLanguage, pokemonLanguageOfReads } from '../../src/shared/scan/pokemonLanguage'

describe('pokemonLanguage', () => {
  it.each([
    ['ピカチュウ HP 60 ワザ', 'ja'],
    ['皮卡丘 HP 60 招式', 'other'],
    ['피카츄 HP 60 기술 전기', 'other'],
    // No English word in it to go on, so not told (fix round 1: English needs positive evidence).
    ['Pikachu HP 60 Gnaw', null],
    ['Pikachu HP 60 Basic Pokémon Gnaw 10 Weakness Resistance Retreat Cost', 'en'],
    [
      "Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed. Discard an Energy from this Pokémon.",
      'en'
    ],
    ['HP', null],
    ['', null]
  ] as const)('%s reads as %s', (text, language) => {
    expect(pokemonLanguage(text)).toBe(language)
  })

  it('takes a Latin language other than English for a language not in the catalog', () => {
    expect(
      pokemonLanguage(
        'Si cette carte est dans votre main, vous pouvez la mettre sur le terrain de votre adversaire.'
      )
    ).toBe('other')
  })

  it('does not take short French or German reads for English', () => {
    expect(pokemonLanguage('Pikachu PV 60 Attaque Faiblesse Résistance Retraite Éclair')).not.toBe(
      'en'
    )
    expect(pokemonLanguage('Pikachu KP 60 Basis Trainer Schwäche Resistenz Rückzug')).not.toBe('en')
  })

  it('does not count katakana that look like kanji, nor a few stray kana among Chinese', () => {
    // 口 read as ロ and the like.
    expect(pokemonLanguage('皮卡丘 HP 60 招式 电击 ロカエタトニハヘ')).toBe('other')
    expect(
      pokemonLanguage(
        '皮卡丘 HP 60 招式 电击 对手的战斗宝可梦 造成伤害 抛掷硬币 正面 麻痹 のでピュウ'
      )
    ).toBe('other')
  })

  it('does not count a dash read as a long-vowel mark for kana', () => {
    expect(pokemonLanguage('ーーーーーー HP 60')).toBeNull()
  })
})

describe('pokemonLanguageOfReads', () => {
  const EN = 'Pikachu HP 60 Basic Pokémon Gnaw 10 Weakness Resistance Retreat Cost'
  const JA = 'ピカチュウ HP 60 ワザ'
  const ZH = '皮卡丘 HP 60 招式'
  const FR =
    'Si cette carte est dans votre main, vous pouvez la mettre sur le terrain de votre adversaire.'
  // What one model makes of text in a script it doesn't know: says nothing.
  const GARBAGE = 'l1 ,. ii'

  it.each([
    // ja only when the jpn read says ja and the eng read doesn't say en.
    [{ jpn: JA, eng: GARBAGE }, 'ja'],
    [{ jpn: JA, eng: EN }, null],
    // en only when the eng read says en and the jpn read doesn't say ja: the jpn model's
    // kana-looking garbage on an English card never makes it Japanese.
    [{ jpn: GARBAGE, eng: EN }, 'en'],
    // other when either read says other.
    [{ jpn: ZH, eng: GARBAGE }, 'other'],
    [{ jpn: GARBAGE, eng: FR }, 'other'],
    [{ jpn: JA, eng: FR }, 'other'],
    [{ jpn: ZH, eng: EN }, 'other'],
    [{ jpn: GARBAGE, eng: GARBAGE }, null],
    [{ jpn: '', eng: '' }, null]
  ] as const)('%j → %s', (reads, expected) => {
    expect(pokemonLanguageOfReads(reads)).toBe(expected)
  })
})
