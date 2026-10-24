import { act, renderHook } from '@testing-library/react'
import { useLanguageFilter, matchesLanguage } from '@/lib/languageFilter'

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
