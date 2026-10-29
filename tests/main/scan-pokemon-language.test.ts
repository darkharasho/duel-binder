import { describe, expect, it } from 'vitest'
import { pokemonLanguage } from '../../src/shared/scan/pokemonLanguage'

describe('pokemonLanguage', () => {
  it.each([
    ['ピカチュウ HP 60 ワザ', 'ja'],
    ['皮卡丘 HP 60 招式', 'other'],
    ['피카츄 HP 60 기술 전기', 'other'],
    ['Pikachu HP 60 Gnaw', 'en'],
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

  it('does not count a dash read as a long-vowel mark for kana', () => {
    expect(pokemonLanguage('ーーーーーー HP 60')).toBeNull()
  })
})
