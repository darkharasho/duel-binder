import { MTG_LANGUAGES, mtgLanguageOf } from '../../src/shared/games/magic'

test('Scryfall language codes map onto the app languages', () => {
  expect(mtgLanguageOf('zhs')).toBe('zh-hans')
  expect(mtgLanguageOf('zht')).toBe('zh-hant')
  expect(mtgLanguageOf('ru')).toBe('ru')
  expect(mtgLanguageOf('en')).toBe('en')
})

test('Scryfall languages the app does not carry map to null', () => {
  expect(mtgLanguageOf('ph')).toBeNull()
  expect(mtgLanguageOf('qya')).toBeNull()
  expect(mtgLanguageOf('toString')).toBeNull()
})

test('the map holds the eleven printed languages', () => {
  expect(Object.keys(MTG_LANGUAGES)).toHaveLength(11)
})
