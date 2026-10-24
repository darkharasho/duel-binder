import { LANGUAGES, isLanguage, languageForSuffix } from '../../src/shared/languages'

test('languageForSuffix maps Yugipedia suffixes', () => {
  expect(languageForSuffix('OCG-JP')).toBe('ja')
  expect(languageForSuffix('TCG-SP')).toBe('es')
  expect(languageForSuffix('TCG-EN')).toBeNull()
  expect(languageForSuffix('XYZ')).toBeNull()
})

test('isLanguage accepts only known codes', () => {
  expect(isLanguage('ja-asia')).toBe(true)
  expect(isLanguage('jp')).toBe(false)
})

test('LANGUAGES starts with English and has unique codes', () => {
  expect(LANGUAGES[0].code).toBe('en')
  expect(new Set(LANGUAGES.map((l) => l.code)).size).toBe(LANGUAGES.length)
})
