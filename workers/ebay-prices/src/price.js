// Pure helpers: no I/O, no imports from app code.
// ebayWord values are copied from src/shared/languages.ts.
export const EBAY_WORDS = Object.freeze({
  en: 'English',
  ja: 'Japanese',
  ko: 'Korean',
  de: 'German',
  fr: 'French',
  it: 'Italian',
  es: 'Spanish',
  pt: 'Portuguese',
  'zh-hans': 'Chinese',
  'zh-hant': 'Chinese',
  ae: 'Asian English',
  'ja-asia': 'Japanese Asian'
})

const CODE_WITHOUT_LANGUAGE = /^[A-Z0-9]+-\d+$/

export function buildQuery({ code, name, set, rarity, lang }) {
  const word = EBAY_WORDS[lang] ?? ''
  const parts = []
  if (code) {
    parts.push(`"${code}"`)
    if (CODE_WITHOUT_LANGUAGE.test(code)) parts.push(word)
  } else {
    parts.push(`"${name}"`, set, word)
  }
  parts.push(rarity)
  return parts.filter(Boolean).join(' ')
}

export function titleMatches(title, { code, name }) {
  const needle = (code || name || '').toLowerCase()
  return needle !== '' && String(title).toLowerCase().includes(needle)
}

function median(sorted) {
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

export function askingPrice(prices) {
  const sorted = prices.filter((p) => Number.isFinite(p)).sort((a, b) => a - b)
  if (sorted.length === 0) return { price: null, listingCount: 0 }
  const m = median(sorted)
  const kept = sorted.filter((p) => p >= m / 3 && p <= m * 3)
  if (kept.length < 2) return { price: null, listingCount: kept.length }
  return { price: Math.round(median(kept) * 100) / 100, listingCount: kept.length }
}
