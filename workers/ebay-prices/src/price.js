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

// A Manga-Style card's tone, as the app names it after the rarity: "Ultra Rare (Manga-Style, Color)".
const TONED_RARITY = /^(.*?)\s*\([^()]*,\s*(color|monochrome)\)\s*$/i
// How sellers name the tones: "Monochrome", "Black & White Edition", "B&W", 白黒, モノクロ; "Full
// Color", "Color Ver.", "Colour", カラー. A bare "colorful" is not a tone.
const MONO_WORDS = /\bmonochrome\b|\bblack\s*(?:&|and|\/)\s*white\b|\bb\s*[&/]\s*w\b|白黒|モノクロ/i
const COLOR_WORDS = /\bcolou?r\b|\bcolou?r(?:ed)?\s+ver|カラー/i

/** The tone a rarity asks for ("color" or "monochrome"), or null for none. */
export function rarityTone(rarity) {
  const m = TONED_RARITY.exec(String(rarity))
  return m ? m[2].toLowerCase() : null
}

/** A toned rarity without its tone: "Ultra Rare" for "Ultra Rare (Manga-Style, Color)". */
function untoned(rarity) {
  const m = TONED_RARITY.exec(String(rarity))
  return m ? m[1] : rarity
}

/** The tone a listing names, or null when it names neither or both. */
export function titleTone(title) {
  const mono = MONO_WORDS.test(String(title))
  const color = COLOR_WORDS.test(String(title))
  return mono === color ? null : mono ? 'monochrome' : 'color'
}

/** True when the rarity asks for no tone, or the listing names the one it asks for. */
export function matchesTone(title, rarity) {
  const tone = rarityTone(rarity)
  return tone === null || titleTone(title) === tone
}

export function buildQuery({ code, name, set, rarity: asked, lang }) {
  // Sellers spell the tone too many ways to put it in the query; listings are sorted by it after.
  const rarity = untoned(asked)
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

// Slabs, lots, several copies ("3x", "x3", "playset") and fakes are priced unlike a single raw card.
const NOT_A_SINGLE_CARD =
  /\b(psa|bgs|cgc|sgc|beckett|graded|slab|lot|bundle|proxy|orica|custom|playsets?|set of \d+|\d+ copies)\b|\b[2-9]\s?x\b|\bx\s?[2-9]\b/i

export function isSingleCard(title) {
  return !NOT_A_SINGLE_CARD.test(String(title))
}

const RARITY_PHRASES = [
  // Longer catalog rarities first; each contains a shorter phrase below (see set.js RARITY_ALIASES).
  'duel terminal normal rare parallel rare',
  'duel terminal normal parallel rare',
  'duel terminal secret parallel rare',
  'duel terminal super parallel rare',
  'duel terminal ultra parallel rare',
  'duel terminal rare parallel rare',
  'kaiba corporation ultra rare',
  'kaiba corporation common',
  'extra secret parallel rare',
  'holographic parallel rare',
  'secret parallel rare',
  'super parallel rare',
  'millennium secret rare',
  'millennium super rare',
  'millennium ultra rare',
  'millennium gold rare',
  'millennium rare',
  'premium gold rare',
  '10000 secret rare',
  '20th secret rare',
  'gold secret rare',
  'ultra secret rare',
  'holographic rare',
  'quarter century secret rare',
  'prismatic secret rare',
  'starlight rare',
  'ghost rare',
  'ultimate rare',
  "collector's rare",
  'extra secret rare',
  'secret rare',
  'ultra rare',
  'super rare',
  'gold rare',
  'platinum rare',
  'ultra parallel rare',
  'normal parallel rare',
  'rare parallel rare',
  'parallel rare'
]

/** True when the title names a rarity the requested one doesn't contain (e.g. "Secret Rare" for a Common). */
export function namesOtherRarity(title, rarity) {
  const t = String(title).toLowerCase()
  const r = String(rarity).toLowerCase()
  return RARITY_PHRASES.some((phrase) => t.includes(phrase) && !r.includes(phrase))
}

// True when every word of `part` appears in `phrase`, in order ("ultra rare" in "ultra parallel rare").
function containsWords(phrase, part) {
  const words = phrase.split(' ')
  let i = 0
  for (const w of part.split(' ')) {
    i = words.indexOf(w, i) + 1
    if (i === 0) return false
  }
  return true
}

/** True when the title names a longer rarity that contains the requested one ("Quarter Century Secret Rare" for a Secret Rare). */
export function namesLongerRarity(title, rarity) {
  const t = String(title).toLowerCase()
  const r = String(untoned(rarity)).toLowerCase()
  if (r === '') return false
  return RARITY_PHRASES.some(
    (phrase) => t.includes(phrase) && phrase !== r && containsWords(phrase, r)
  )
}

function median(sorted) {
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** The prices within a factor of three of their median, low to high. */
export function keptPrices(prices) {
  const sorted = prices.filter((p) => Number.isFinite(p)).sort((a, b) => a - b)
  if (sorted.length === 0) return []
  const m = median(sorted)
  return sorted.filter((p) => p >= m / 3 && p <= m * 3)
}

export function askingPrice(prices) {
  const kept = keptPrices(prices)
  if (kept.length === 0) return { price: null, listingCount: 0 }
  if (kept.length < 2) return { price: null, listingCount: kept.length }
  return { price: Math.round(median(kept) * 100) / 100, listingCount: kept.length }
}
