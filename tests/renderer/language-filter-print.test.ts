import { describe, expect, it } from 'vitest'
import { printedLanguage } from '@/lib/languageFilter'

describe('printedLanguage', () => {
  it('is a language the filter was set to', () => {
    expect(printedLanguage('ko')).toBe('ko')
  })

  it('is nothing for all languages, or English, which is only the default', () => {
    expect(printedLanguage('all')).toBeNull()
    expect(printedLanguage('en')).toBeNull()
  })
})
