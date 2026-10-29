// Pure helpers for the set-wide sweep: no I/O, no imports from app code.
import { isSingleCard, askingPrice } from './price.js'

// Title tokens -> the catalog's set_rarity names.
export const RARITY_ALIASES = Object.freeze({
  N: 'Common',
  Common: 'Common',
  R: 'Rare',
  SR: 'Super Rare',
  UR: 'Ultra Rare',
  SE: 'Secret Rare',
  SCR: 'Secret Rare',
  PSE: 'Prismatic Secret Rare',
  PSER: 'Prismatic Secret Rare',
  QCSE: 'Quarter Century Secret Rare',
  QCSCR: 'Quarter Century Secret Rare',
  UL: 'Ultimate Rare',
  Relief: 'Ultimate Rare',
  CR: "Collector's Rare",
  NP: 'Normal Parallel Rare',
  'N-P': 'Normal Parallel Rare',
  Parallel: 'Normal Parallel Rare',
  UPR: 'Ultra Parallel Rare',
  GR: 'Gold Rare',
  NR: 'Normal Rare',
  // Spelled-out names, so a longer one swallows the short tokens inside it.
  'Quarter Century Secret Rare': 'Quarter Century Secret Rare',
  'Quarter Century Secret': 'Quarter Century Secret Rare',
  'Prismatic Secret Rare': 'Prismatic Secret Rare',
  'Prismatic Secret': 'Prismatic Secret Rare',
  'Ultimate Rare': 'Ultimate Rare',
  "Collector's Rare": "Collector's Rare",
  'Normal Parallel Rare': 'Normal Parallel Rare',
  'Ultra Parallel Rare': 'Ultra Parallel Rare',
  'Millennium Rare': 'Millennium Rare',
  'Normal Rare': 'Normal Rare',
  'Secret Rare': 'Secret Rare',
  'Ultra Rare': 'Ultra Rare',
  'Super Rare': 'Super Rare',
  'Gold Rare': 'Gold Rare',
  'Extra Secret Rare': 'Extra Secret Rare',
  'Rare Parallel Rare': 'Rare Parallel Rare',
  'Short Print': 'Short Print',
  'Super Short Print': 'Super Short Print',
  // 25th alone is the anniversary, not the rarity.
  '25th Secret Rare': 'Quarter Century Secret Rare',
  '25th Secret': 'Quarter Century Secret Rare',
  '25th Anniversary Secret Rare': 'Quarter Century Secret Rare',
  '25th Anniversary Secret': 'Quarter Century Secret Rare',
  // Every catalog rarity (ja, ko, zh, ae) that contains a shorter alias maps to itself, so it is never
  // read as that inner rarity ("Gold Secret Rare" is not "Secret Rare").
  'Secret Parallel Rare': 'Secret Parallel Rare',
  'Super Parallel Rare': 'Super Parallel Rare',
  'Extra Secret Parallel Rare': 'Extra Secret Parallel Rare',
  'Holographic Parallel Rare': 'Holographic Parallel Rare',
  'Holographic Rare': 'Holographic Rare',
  '10000 Secret Rare': '10000 Secret Rare',
  '20th Secret Rare': '20th Secret Rare',
  'Gold Secret Rare': 'Gold Secret Rare',
  'Ultra Secret Rare': 'Ultra Secret Rare',
  'Millennium Gold Rare': 'Millennium Gold Rare',
  'Millennium Secret Rare': 'Millennium Secret Rare',
  'Millennium Super Rare': 'Millennium Super Rare',
  'Millennium Ultra Rare': 'Millennium Ultra Rare',
  'Premium Gold Rare': 'Premium Gold Rare',
  'Kaiba Corporation Common': 'Kaiba Corporation Common',
  'Kaiba Corporation Ultra Rare': 'Kaiba Corporation Ultra Rare',
  'Secret Rare Special Blue Version': 'Secret Rare Special Blue Version',
  'Duel Terminal Normal Parallel Rare': 'Duel Terminal Normal Parallel Rare',
  'Duel Terminal Normal Rare Parallel Rare': 'Duel Terminal Normal Rare Parallel Rare',
  'Duel Terminal Rare Parallel Rare': 'Duel Terminal Rare Parallel Rare',
  'Duel Terminal Secret Parallel Rare': 'Duel Terminal Secret Parallel Rare',
  'Duel Terminal Super Parallel Rare': 'Duel Terminal Super Parallel Rare',
  'Duel Terminal Ultra Parallel Rare': 'Duel Terminal Ultra Parallel Rare',
  // Catalog art and version variants, whole.
  "Collector's Rare (Alternate art)": "Collector's Rare (Alternate art)",
  'Common (Alternate art)': 'Common (Alternate art)',
  'Common (Alternate artwork)': 'Common (Alternate artwork)',
  'Common (International artwork)': 'Common (International artwork)',
  'Common (Overframe)': 'Common (Overframe)',
  'Normal Parallel Rare (Alternate art)': 'Normal Parallel Rare (Alternate art)',
  'Premium Gold Rare (Alternate art)': 'Premium Gold Rare (Alternate art)',
  'Prismatic Secret Rare (Alternate art)': 'Prismatic Secret Rare (Alternate art)',
  'Quarter Century Secret Rare (2nd artwork)': 'Quarter Century Secret Rare (2nd artwork)',
  'Quarter Century Secret Rare (3rd artwork)': 'Quarter Century Secret Rare (3rd artwork)',
  'Quarter Century Secret Rare (4th artwork)': 'Quarter Century Secret Rare (4th artwork)',
  'Quarter Century Secret Rare (6th artwork)': 'Quarter Century Secret Rare (6th artwork)',
  'Quarter Century Secret Rare (7th artwork)': 'Quarter Century Secret Rare (7th artwork)',
  'Quarter Century Secret Rare (8th artwork)': 'Quarter Century Secret Rare (8th artwork)',
  'Quarter Century Secret Rare (9th artwork)': 'Quarter Century Secret Rare (9th artwork)',
  'Quarter Century Secret Rare (Alternate art)': 'Quarter Century Secret Rare (Alternate art)',
  'Quarter Century Secret Rare (Alternate artwork)':
    'Quarter Century Secret Rare (Alternate artwork)',
  'Quarter Century Secret Rare (International artwork)':
    'Quarter Century Secret Rare (International artwork)',
  'Quarter Century Secret Rare (New artwork)': 'Quarter Century Secret Rare (New artwork)',
  'Secret Parallel Rare (Alternate art)': 'Secret Parallel Rare (Alternate art)',
  'Secret Rare (2nd artwork)': 'Secret Rare (2nd artwork)',
  'Secret Rare (3rd artwork)': 'Secret Rare (3rd artwork)',
  'Secret Rare (4th artwork)': 'Secret Rare (4th artwork)',
  'Secret Rare (6th artwork)': 'Secret Rare (6th artwork)',
  'Secret Rare (7th artwork)': 'Secret Rare (7th artwork)',
  'Secret Rare (8th artwork)': 'Secret Rare (8th artwork)',
  'Secret Rare (9th artwork)': 'Secret Rare (9th artwork)',
  'Secret Rare (Alternate art)': 'Secret Rare (Alternate art)',
  'Secret Rare (Alternate artwork)': 'Secret Rare (Alternate artwork)',
  'Secret Rare (Edited artwork)': 'Secret Rare (Edited artwork)',
  'Secret Rare (International artwork)': 'Secret Rare (International artwork)',
  'Secret Rare (Japanese artwork)': 'Secret Rare (Japanese artwork)',
  'Secret Rare (New artwork)': 'Secret Rare (New artwork)',
  'Secret Rare (Special Blue Version)': 'Secret Rare (Special Blue Version)',
  'Secret Rare (Special Red Version)': 'Secret Rare (Special Red Version)',
  'Short Print (Alternate art)': 'Short Print (Alternate art)',
  'Super Rare (Alternate art)': 'Super Rare (Alternate art)',
  'Ultimate Rare (Alternate art)': 'Ultimate Rare (Alternate art)',
  'Ultimate Rare (Manga-Style Color Version)': 'Ultimate Rare (Manga-Style Color Version)',
  'Ultra Parallel Rare (Alternate art)': 'Ultra Parallel Rare (Alternate art)',
  'Ultra Rare (2nd artwork)': 'Ultra Rare (2nd artwork)',
  'Ultra Rare (3rd artwork)': 'Ultra Rare (3rd artwork)',
  'Ultra Rare (Alternate art)': 'Ultra Rare (Alternate art)',
  'Ultra Rare (Alternate artwork)': 'Ultra Rare (Alternate artwork)',
  'Ultra Rare (Overframe)': 'Ultra Rare (Overframe)',
  'Ultra Rare (Special Blue Version)': 'Ultra Rare (Special Blue Version)',
  'Ultra Rare (Special Purple Version)': 'Ultra Rare (Special Purple Version)'
})

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// Whole words only, so R never matches inside "Rescue". Short tokens (N, R, SR...) must be
// upper case and not touch a hyphen or apostrophe, so "Rock 'n' Roll" and "Link-R" stay unread.
const isShort = (token) => token === token.toUpperCase()
const ALIAS_PATTERNS = Object.entries(RARITY_ALIASES).map(([token, rarity]) => {
  const short = isShort(token)
  const edge = short ? "A-Za-z0-9'\u2019-" : 'A-Za-z0-9'
  return {
    rarity,
    re: new RegExp(`(?<![${edge}])${escape(token)}(?![${edge}])`, short ? 'g' : 'gi')
  }
})

/** CORI-JP025 -> CORI-JP. */
export function sweepKey(code) {
  return String(code).replace(/\d+$/, '')
}

export function parseListing(title, key) {
  const text = String(title)
  const codeRe = new RegExp(`${escape(key)}\\d+`, 'i')
  const found = codeRe.exec(text)
  if (!found) return { code: null, rarity: null }
  // Blank the code out so its own letters are never read as a rarity token.
  const rest = text.slice(0, found.index) + ' ' + text.slice(found.index + found[0].length)

  const spans = []
  for (const { rarity, re } of ALIAS_PATTERNS) {
    for (const m of rest.matchAll(re))
      spans.push({ rarity, start: m.index, end: m.index + m[0].length })
  }
  // A match inside a longer match for another rarity is part of that longer name.
  const kept = spans.filter(
    (a) =>
      !spans.some(
        (b) =>
          b.rarity !== a.rarity &&
          b.start <= a.start &&
          b.end >= a.end &&
          b.end - b.start > a.end - a.start
      )
  )
  const rarities = new Set(kept.map((s) => s.rarity))
  return { code: found[0].toUpperCase(), rarity: rarities.size === 1 ? [...rarities][0] : null }
}

export function setPrices(items, key) {
  const groups = new Map() // code -> { all: number[], byRarity: Map<string, number[]> }
  for (const i of items) {
    if (!isSingleCard(i.title) || i.price?.currency !== 'USD') continue
    const value = Number.parseFloat(i.price.value)
    if (!Number.isFinite(value)) continue
    const { code, rarity } = parseListing(i.title, key)
    if (!code) continue
    let g = groups.get(code)
    if (!g) groups.set(code, (g = { all: [], byRarity: new Map() }))
    g.all.push(value)
    if (rarity) {
      if (!g.byRarity.has(rarity)) g.byRarity.set(rarity, [])
      g.byRarity.get(rarity).push(value)
    }
  }
  const codes = {}
  for (const [code, g] of groups) {
    codes[code] = {
      all: askingPrice(g.all),
      byRarity: Object.fromEntries([...g.byRarity].map(([r, p]) => [r, askingPrice(p)]))
    }
  }
  return { codes }
}
