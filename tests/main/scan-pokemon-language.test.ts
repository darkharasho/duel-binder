import { describe, expect, it } from 'vitest'
import { pokemonLanguage } from '../../src/shared/scan/pokemonLanguage'

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
