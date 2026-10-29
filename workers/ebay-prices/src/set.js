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
  '25th': 'Quarter Century Secret Rare',
  UL: 'Ultimate Rare',
  Relief: 'Ultimate Rare',
  CR: "Collector's Rare",
  NP: 'Normal Parallel Rare',
  'N-P': 'Normal Parallel Rare',
  Parallel: 'Normal Parallel Rare',
  UPR: 'Ultra Parallel Rare',
  GR: 'Gold Rare',
  M: 'Millennium Rare',
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
  'Gold Rare': 'Gold Rare'
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
