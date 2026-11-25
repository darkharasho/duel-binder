import { act, renderHook } from '@testing-library/react'
import { useLanguageFilter, matchesLanguage, setLanguageMatcher } from '@/lib/languageFilter'

beforeEach(() => localStorage.clear())

describe('useLanguageFilter', () => {
  it('defaults to en', () => {
    const { result } = renderHook(() => useLanguageFilter())
    expect(result.current[0]).toBe('en')
  })

  it('persists a chosen language', () => {
    const { result } = renderHook(() => useLanguageFilter())
    act(() => result.current[1]('ja'))
    expect(result.current[0]).toBe('ja')
    expect(localStorage.getItem('language.filter')).toBe('ja')
    expect(renderHook(() => useLanguageFilter()).result.current[0]).toBe('ja')
  })

  it('reads an invalid stored value as en', () => {
    localStorage.setItem('language.filter', 'jp')
    const { result } = renderHook(() => useLanguageFilter())
    expect(result.current[0]).toBe('en')
  })
})

describe('matchesLanguage', () => {
  it('all matches everything, a language only itself', () => {
    expect(matchesLanguage('all', 'ko')).toBe(true)
    expect(matchesLanguage('ja', 'ja')).toBe(true)
    expect(matchesLanguage('ja', 'en')).toBe(false)
  })
})

describe('setLanguageMatcher', () => {
  const sets = [
    { setName: 'Age of Overlord', language: 'en' as const },
    { setName: 'Age of Overlord', language: 'ae' as const },
    { setName: 'Essential Selection 01', language: 'ae' as const },
    { setName: 'Essential Selection 01', language: 'ja' as const }
  ]
  const listed = (f: Parameters<typeof setLanguageMatcher>[0]): string[] =>
    sets.filter(setLanguageMatcher(f, sets)).map((s) => `${s.setName}|${s.language}`)

  it('English also lists Asian-English sets with no English release', () => {
    expect(listed('en')).toEqual(['Age of Overlord|en', 'Essential Selection 01|ae'])
  })

  it('other filters list their own language only', () => {
    expect(listed('ae')).toEqual(['Age of Overlord|ae', 'Essential Selection 01|ae'])
    expect(listed('ja')).toEqual(['Essential Selection 01|ja'])
    expect(listed('all')).toHaveLength(4)
  })
})
