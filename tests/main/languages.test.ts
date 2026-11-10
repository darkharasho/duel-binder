import { LANGUAGES, isLanguage, languageForSuffix, languageInfo } from '../../src/shared/languages'

test('languageForSuffix maps Yugipedia suffixes', () => {
  expect(languageForSuffix('OCG-JP')).toBe('ja')
  expect(languageForSuffix('TCG-SP')).toBe('es')
  expect(languageForSuffix('TCG-EN')).toBe('en')
  expect(languageForSuffix('TCG-NA')).toBeNull()
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

test('Russian is listed after Portuguese and has no Yugipedia list', () => {
  expect(languageInfo('ru')).toEqual({ code: 'ru', tag: 'RU', label: 'Russian', yugipediaSuffix: null, ebayWord: 'Russian' })
  expect(LANGUAGES.map((l) => l.code)).toEqual([
    'en', 'ja', 'ko', 'de', 'fr', 'it', 'es', 'pt', 'ru', 'zh-hans', 'zh-hant', 'ae', 'ja-asia'
  ])
  for (const l of LANGUAGES) {
    if (l.yugipediaSuffix) expect(languageForSuffix(l.yugipediaSuffix)).toBe(l.code)
  }
  expect(LANGUAGES.filter((l) => languageForSuffix(l.yugipediaSuffix ?? '') === 'ru')).toHaveLength(0)
})
