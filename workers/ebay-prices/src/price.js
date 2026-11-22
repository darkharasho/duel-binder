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

// An overframe printing, as the catalog names it: "Ultra Rare (Overframe)".
const OVERFRAME_RARITY = /\(\s*over\s*-?\s*frame\s*\)\s*$/i
// How sellers name an overframe: "Overframe", "Over Frame", "Extended Art", "Extended", "Ext Art",
// a title cut short at "(Exte…", オーバーフレーム.
const OVERFRAME_WORDS =
  /\bover\s*-?\s*frame\b|\bextended\b|\bext\.?\s*art\b|\(exte|オーバーフレーム/i
// Rarities sellers write without "Rare" ("MAMS-EN001 Starlight"), so RARITY_PHRASES misses them.
const BARE_RARITY_WORDS = [
  'starlight',
  'ghost',
  'grand master',
  'quarter century',
  'prismatic',
  'secret',
  "collector's",
  'platinum'
]

/** True for an overframe rarity: "Ultra Rare (Overframe)". */
export function isOverframe(rarity) {
  return OVERFRAME_RARITY.test(String(rarity))
}

/** True when the listing names an overframe, however the seller spells it. */
export function namesOverframe(title) {
  return OVERFRAME_WORDS.test(String(title))
}

/**
 * True when the title, card name aside, names a rarity word the requested rarity lacks, even
 * without "Rare" ("Extended MAMS-EN001 Starlight" for an Ultra Rare). The card name is taken out
 * first, so "Starlight Road" or "Ghost Ogre" isn't read as a rarity.
 */
export function namesBareRarity(title, rarity, name = '') {
  let t = String(title).toLowerCase()
  const n = String(name).toLowerCase()
  if (n) t = t.split(n).join(' ')
  const r = String(rarity).toLowerCase()
  return BARE_RARITY_WORDS.some(
    (w) => new RegExp(`(?<![a-z])${w}(?![a-z])`).test(t) && !r.includes(w)
  )
}

export function buildQuery({ code, name, set, rarity: asked, lang }) {
  // Sellers spell the tone too many ways to put it in the query; listings are sorted by it after.
  // An overframe goes without rarity words: sellers write "Extended Ultra", "Ext Art", "Overframe".
  const rarity = isOverframe(asked) ? '' : untoned(asked)
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

// Graded copies (slabs): one printing at one grader's grade.

/** How sellers write each grader's name in a title. */
const GRADER_NAMES = Object.freeze({
  PSA: 'psa',
  BGS: '(?:bgs|beckett)',
  CGC: 'cgc',
  SGC: 'sgc',
  TAG: 'tag',
  ACE: 'ace',
  AGS: 'ags',
  ARS: 'ars',
  PCG: 'pcg',
  CCIC: 'ccic'
})

export const isGrader = (company) => Object.hasOwn(GRADER_NAMES, company)

/** A grade the app knows: 1 to 10 in half steps, or Authentic. */
export const isGrade = (grade) => /^(10|[1-9](\.5)?|Authentic)$/.test(String(grade))

// Reprint lines that copy an older card's name and number (Celebrations' Classic Collection
// prints Base Set's Charizard as 4/102 again).
const REPRINT_LINES = [/\bcelebrations?\b/, /\bclassic collection\b/]

// What a promo's listing says: "Black Star Promo", "SVP", "SWSH Promo".
const PROMO_WORDS =
  /\bpromos?\b|black\s*star|\b(?:svp|smp|swshp|xyp|bwp|dpp|hgssp|basep|mep|sv-p|m-p)\b/

// Lots, several copies and fakes: a graded listing of one card says none of these.
const NOT_ONE_SLAB =
  /\b(lot|bundle|proxy|orica|custom|set of \d+|\d+ copies|choose|pick|you pick|u pick)\b|\b[2-9]\s?x\b|\bx\s?[2-9]\b/i

// eBay matches "141/86" and "141/086" as different words, so the search names each way a seller
// writes the number: padded to three digits as the card prints it, a gallery total with the
// number's letters ("GG49/GG70"). One OR group: "(141/86,141/086)".
const pad3 = (x) => (/^\d{1,2}$/.test(x) ? [x, x.padStart(3, '0')] : [x])

/** Every way a seller writes a collector number ("4/102", "#004/102"), for the search. */
export function numberForms(number) {
  const [n, total] = String(number ?? '')
    .trim()
    .split('/')
  if (!n) return []
  const ns = pad3(n)
  if (!total) return ns
  const letters = /^([A-Za-z]+)\d/.exec(n)?.[1]
  const totals = [...pad3(total), ...(letters && /^\d+$/.test(total) ? [letters + total] : [])]
  return [...new Set(ns.flatMap((a) => totals.map((b) => `${a}/${b}`)))]
}

function numberTerm(number) {
  const forms = numberForms(number)
  return forms.length > 1 ? `(${forms.join(',')})` : (forms[0] ?? '')
}

/**
 * The search for one printing in a slab: its code (Yu-Gi-Oh's are unique), or its name and
 * collector number, then the grader and grade, and the language word for a non-English card.
 */
export function buildGradedQuery({ code, name, number, lang, company, grade, edition }) {
  const parts = code ? [`"${code}"`] : [`"${name}"`, numberTerm(number)]
  if (edition === '1st') parts.push('1st')
  parts.push(company, grade === 'Authentic' ? 'Authentic' : grade)
  if (lang && lang !== 'en') parts.push(EBAY_WORDS[lang] ?? '')
  return parts.filter(Boolean).join(' ')
}

const escape = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * True when a title is one slab of the asked printing at the asked grade: it names the code, or
 * the name and the collector number; it names the grader with exactly this grade ("PSA 10", "PSA
 * GEM MINT 10", never "PSA 1" for a 10 or "PSA 9" for a 9.5); and it isn't a lot. An English
 * card's listing that says Japanese (or the other way) is another printing.
 */
export function gradedTitleMatches(
  title,
  { code, name, number, set, lang, company, grade, edition }
) {
  const t = String(title).toLowerCase()
  // A Pokémon 1st Edition printing sells for many times its Unlimited one, and the other way.
  const first = /\b1st\b|first edition/.test(t)
  if (edition === '1st' && !first) return false
  // Shadowless is Base Set's early print, priced well above its Unlimited one.
  if (edition === 'unlimited' && (first || /\bshadowless\b/.test(t))) return false
  if (code) {
    if (!t.includes(code.toLowerCase())) return false
  } else {
    if (!name || !t.includes(name.toLowerCase())) return false
    if (number) {
      // "4/102" asks for its set's total too ("4/102", "#004/102"): Base Set 2's Charizard is a
      // 4 as well. A number alone ("5", "TG05") is "#5", "005" or " 5 ", standing alone.
      const [n, total] = String(number)
        .toLowerCase()
        .split('/')
        .map((x) => escape(x.trim().replace(/^0+(?=\d)/, '')))
      // The total may be padded ("141/086") or carry the number's letters ("GG49/GG70"); the
      // number itself never follows a slash (that's some other card's total: "021/028").
      const tail = total ? `\\s*\\/\\s*[a-z]{0,3}0*${total}` : ''
      const re = new RegExp(`(?<![\\w./])(?:#\\s*)?0*${n}${tail}(?![\\w.]|\\.\\d)`)
      if (!re.test(t)) return false
    }
    // Reprints that print the same name and number: only when they're the printing asked for.
    const asked = String(set ?? '').toLowerCase()
    for (const reprint of REPRINT_LINES) if (reprint.test(t) && !reprint.test(asked)) return false
    // A promo's catalog total isn't printed on it, so its number alone is all there is to go on:
    // the listing has to say it's a promo too.
    if (/\bpromo/.test(asked) && !PROMO_WORDS.test(t)) return false
  }
  const who = GRADER_NAMES[company]
  if (!who) return false
  const words = '(?:\\s*(?:gem\\s*mint|gem\\s*mt|gem|mint|pristine|black\\s*label))?'
  const what =
    grade === 'Authentic'
      ? '\\s*(?:authentic|auth\\b|a\\b)'
      : `${words}\\s*-?\\s*${escape(grade)}(?![\\d]|\\.\\d)`
  if (!new RegExp(`\\b${who}${what}`).test(t)) return false
  if (NOT_ONE_SLAB.test(t)) return false
  const japanese = /\b(japanese|japan|jpn|jp)\b|日本/.test(t)
  if (lang === 'en' && japanese) return false
  if (lang === 'ja' && !japanese) return false
  return true
}
