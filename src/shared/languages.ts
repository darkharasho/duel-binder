export type Language =
  | 'en'
  | 'ja'
  | 'ko'
  | 'de'
  | 'fr'
  | 'it'
  | 'es'
  | 'pt'
  | 'zh-hans'
  | 'zh-hant'
  | 'ae'
  | 'ja-asia'

export interface LanguageInfo {
  code: Language
  /** Short tag shown next to a set's English name. */
  tag: string
  label: string
  /** Yugipedia "Set Card Lists" page suffix; null for English (synced from YGOPRODeck). */
  yugipediaSuffix: string | null
  ebayWord: string
}

export type LanguageFilter = Language | 'all'

/** Display order everywhere languages are listed. */
export const LANGUAGES: readonly LanguageInfo[] = [
  { code: 'en', tag: 'EN', label: 'English', yugipediaSuffix: null, ebayWord: 'English' },
  { code: 'ja', tag: 'JP', label: 'Japanese', yugipediaSuffix: 'OCG-JP', ebayWord: 'Japanese' },
  { code: 'ko', tag: 'KR', label: 'Korean', yugipediaSuffix: 'OCG-KR', ebayWord: 'Korean' },
  { code: 'de', tag: 'DE', label: 'German', yugipediaSuffix: 'TCG-DE', ebayWord: 'German' },
  { code: 'fr', tag: 'FR', label: 'French', yugipediaSuffix: 'TCG-FR', ebayWord: 'French' },
  { code: 'it', tag: 'IT', label: 'Italian', yugipediaSuffix: 'TCG-IT', ebayWord: 'Italian' },
  { code: 'es', tag: 'ES', label: 'Spanish', yugipediaSuffix: 'TCG-SP', ebayWord: 'Spanish' },
  { code: 'pt', tag: 'PT', label: 'Portuguese', yugipediaSuffix: 'TCG-PT', ebayWord: 'Portuguese' },
  { code: 'zh-hans', tag: 'SC', label: 'Simplified Chinese', yugipediaSuffix: 'OCG-SC', ebayWord: 'Chinese' },
  { code: 'zh-hant', tag: 'TC', label: 'Traditional Chinese', yugipediaSuffix: 'OCG-TC', ebayWord: 'Chinese' },
  { code: 'ae', tag: 'AE', label: 'Asian-English', yugipediaSuffix: 'OCG-AE', ebayWord: 'Asian English' },
  { code: 'ja-asia', tag: 'JA', label: 'Japanese-Asian', yugipediaSuffix: 'OCG-JA', ebayWord: 'Japanese Asian' }
]

const BY_CODE = new Map<string, LanguageInfo>(LANGUAGES.map((l) => [l.code, l]))
const BY_SUFFIX = new Map<string, Language>(
  LANGUAGES.filter((l) => l.yugipediaSuffix !== null).map((l) => [l.yugipediaSuffix as string, l.code])
)

export function isLanguage(v: unknown): v is Language {
  return typeof v === 'string' && BY_CODE.has(v)
}

export function languageInfo(code: Language): LanguageInfo {
  const info = BY_CODE.get(code)
  if (!info) throw new Error(`Unknown language: ${code}`)
  return info
}

/** Maps a Yugipedia list suffix such as 'OCG-JP' to its language; null for English or unknown. */
export function languageForSuffix(suffix: string): Language | null {
  return BY_SUFFIX.get(suffix) ?? null
}
