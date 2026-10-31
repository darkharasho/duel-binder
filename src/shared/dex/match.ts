import type { DexRow } from './parse'

/**
 * Dex rows to Pokémon printings. A wrong card or finish is worse than a skipped row, so a row lands
 * on a printing only when the set (by Dex id and by name), the printed number and the card name all
 * agree and the finish is one we hold. Anything else goes on the not-imported list; nothing here
 * falls back to a near match, and a card of one language never lands on another language's printing.
 */

/** A live Pokémon printing, as the import sees the catalog. */
export interface DexCatalogPrinting {
  id: number
  cardId: number
  /** pokemon_cards.source_id: `{lang}/{TCGdex set id}-{TCGdex local id}`. */
  sourceId: string
  setName: string
  /** The version label (card_printings.set_rarity). */
  version: string
  cardName: string
  language: string
}

export type DexMissReason = 'quantity' | 'language' | 'set' | 'number' | 'name' | 'finish' | 'image'

export interface DexMissing {
  name: string
  set: string
  number: string
  variant: string
  locale: string
  quantity: number
  reason: DexMissReason
}

export interface DexMatch {
  /** Printing id to the count the files hold of it. */
  wanted: Map<number, { cardId: number; quantity: number; row: DexRow }>
  missing: DexMissing[]
  /** Rows with quantity 0. */
  zeroRows: number
  /** Rows that repeat a card another list or file already gave. */
  repeatRows: number
}

export interface DexPreview {
  /** Copies the import would add. */
  copies: number
  /** Printings it would add to. */
  printings: number
  /** Printings the collection already holds at or above the file's count. */
  alreadyOwned: number
  zeroRows: number
  repeatRows: number
  notImported: DexMissing[]
}

/** Dex's locale column to the catalog's language. "International" is what Dex calls English. */
const LOCALES: Record<string, string> = {
  International: 'en',
  Japanese: 'ja',
  'Simplified Chinese': 'zh-hans',
  'Traditional Chinese': 'zh-hant',
  Korean: 'ko'
}

/**
 * Dex set ids to TCGdex's, checked against every sample export (2026-10-30), for ids that differ or
 * whose set name differs from ours. An id not here must find its set by name.
 */
// prettier-ignore
const DEX_SETS: Record<string, string> = {
  sv1: 'sv01', sv2: 'sv02', sv3: 'sv03', sv35: 'sv03.5', sv4: 'sv04', sv5: 'sv05', sv6: 'sv06', sv7: 'sv07',
  sv8: 'sv08', sv85: 'sv08.5', sv9: 'sv09', sv105b: 'sv10.5b', sv105w: 'sv10.5w',
  me1: 'me01', me2: 'me02', me5: 'me05', me55: '30th', me55cc: '30th-c',
  swsh12pt5: 'swsh12.5', swsh12pt5gg: 'swsh12.5gg', swsh35: 'swsh3.5', pgo: 'swsh10.5', sm75: 'sm7.5', smp: 'smp',
  tk1a: 'tk-ex-latia', tk3a: 'tk-dp-m', tk8a: 'tk-xy-latio', tk9a: 'tk-xy-p', mcd15: '2015xy', mfbp: 'mfb',
  mee: 'mee', uen23: 'sve', mep: 'mep', svp: 'svp', swshp: 'swshp', xyp: 'xyp', basep: 'basep'
}

/** The same for Japanese sets, whose ids Dex prefixes and whose names can differ from ours. */
const DEX_JA_SETS: Record<string, string> = { jpn_m2a: 'M2a', jpn_mc: 'MC', jpn_svp: 'SV-P' }

/**
 * Sets whose finish Dex and the catalog name differently: every 30th Celebration card is one card
 * to Dex's "Holo" and our "Normal", and a promo is sold in one finish whatever Dex calls it. In
 * these, a card with a single live version takes the row.
 */
const ONE_FINISH_SETS = new Set(['me55', 'me55cc', 'mep', 'svp', 'swshp', 'xyp', 'basep'])

/** Dex's name for a pattern in sets where it isn't the catalog's: Dex set id, variant, our version. */
const SET_FINISHES: Record<string, Record<string, string>> = {
  // Ascended Heroes' plain reverse is its Energy Symbol pattern.
  me25: { 'Reverse Holo': 'Energy Symbol Pattern' },
  // Japan's reverse in these sets is the Poké Ball pattern; the catalog has one reverse.
  jpn_sv11b: { 'Poké Ball Holo': 'Reverse Holofoil' },
  jpn_sv11w: { 'Poké Ball Holo': 'Reverse Holofoil' }
}

/**
 * TCGdex numbers 30th Classic Collection in another order than Dex's printed numbers, so its Dex
 * numbers are pinned to ours, each pair confirmed by name and illustrator. The two halves of
 * Darkrai & Cresselia LEGEND (Dex 16 and 17, ours 19 and 20) can't be told apart and stay out.
 */
// prettier-ignore
const DEX_NUMBERS: Record<string, Record<string, string>> = {
  me55cc: {
    1: '14', 2: '1', 3: '5', 4: '15', 5: '7', 6: '24', 7: '29', 8: '2', 9: '6', 10: '25', 11: '3', 12: '22', 13: '10',
    14: '11', 15: '18', 18: '21', 19: '16', 20: '4', 21: '23', 22: '9', 23: '17', 24: '13', 25: '8', 26: '28', 27: '12',
    28: '26', 29: '27', 30: '30'
  }
}

/** Dex's variant to our version label. Stamps, jumbos and the like aren't here: no finish, no guess. */
const FINISHES: Record<string, string> = {
  Normal: 'Normal',
  Holo: 'Holofoil',
  'Reverse Holo': 'Reverse Holofoil',
  'Poké Ball Holo': 'Poke Ball Pattern',
  'Master Ball Holo': 'Master Ball Pattern',
  'Friend Ball Holo': 'Friend Ball Pattern',
  'Love Ball Holo': 'Love Ball Pattern',
  'Quick Ball Holo': 'Quick Ball Pattern',
  'Dusk Ball Holo': 'Dusk Ball Pattern',
  'Cosmos Holo': 'Cosmos Holo',
  'Starlight Holo': 'Starlight Holo'
}

/**
 * Dex's "Expansion Stamp" names no finish, and is our "Set Logo" stamp: the 13 Prismatic Evolutions
 * cards Dex lists with it are the 13 we have. It only lands on a card with exactly one such version.
 */
const STAMPED = new Set(['Set Logo Normal', 'Set Logo Holofoil', 'Set Logo Reverse Holofoil'])

/** Lower case, unaccented, letters and digits only ("Champion's Path" = "champions path"). */
const squash = (s: string): string =>
  s
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')

/** A set name for comparing. Dex prefixes the EX series' sets with "EX"; we don't. */
const setKey = (name: string, series = ''): string =>
  squash(series === 'EX' ? name.replace(/^EX\s+/, '') : name)

/** "H25/144" and "007" to "H25" and "7": the printed number without its set total or padding. */
function numberKey(number: string): string {
  const left = number.split('/')[0].trim().toUpperCase()
  const m = /^([A-Z]*)0*(\d+)([A-Z]*)$/.exec(left)
  return m ? `${m[1]}${m[2]}${m[3]}` : left
}

/**
 * Whether Dex's card name is our card's. Dex adds what tells reprints apart: "Professor's Research
 * (Professor Oak)", "Palkia LV.X", "Metagross δ" (squash drops the δ), and calls a basic energy
 * "Basic Grass Energy".
 */
function sameCard(dex: string, ours: string): boolean {
  const want = squash(ours)
  return (
    squash(dex) === want ||
    squash(dex.replace(/^Basic (?=.* Energy$)/, '')) === want ||
    squash(dex.replace(/\s*\([^()]*\)\s*$/, '').replace(/\s+LV\.X$/i, '')) === want
  )
}

/** Dex orders a Chinese form's words its own way ("Sunny Form Castform"); the card is the same. */
const sameWords = (dex: string, ours: string): boolean => {
  const words = (s: string): string => s.split(/\s+/).map(squash).sort().join(' ')
  return words(dex) === words(ours)
}

/** A set flagged with a country in Dex ("McDonald's Collection 2018 (🇫🇷)") isn't our set of that name. */
const REGIONAL = /[\u{1F1E6}-\u{1F1FF}]/u

interface CatalogSet {
  id: string
  cards: Map<string, DexCatalogPrinting[]>
}

interface LanguageIndex {
  byId: Map<string, CatalogSet>
  /** Null for a name two sets share. */
  byName: Map<string, CatalogSet | null>
  /** Simplified Chinese sets by the code Dex's `scn_` ids use. */
  byDexCode: Map<string, CatalogSet>
}

/** A Chinese set id to Dex's code: "CSV9.5C" and "scn_csv95" meet at "csv95", "CSIC" and "scn_csI" at "csi". */
const dexCode = (id: string): string => id.toLowerCase().replace(/\./g, '').replace(/c$/, '')

function indexCatalog(catalog: DexCatalogPrinting[]): Map<string, LanguageIndex> {
  const languages = new Map<string, LanguageIndex>()
  for (const p of catalog) {
    const slash = p.sourceId.indexOf('/')
    const dash = p.sourceId.lastIndexOf('-')
    if (slash < 0 || dash < slash) continue
    const id = p.sourceId.slice(slash + 1, dash)
    let lang = languages.get(p.language)
    if (!lang) languages.set(p.language, (lang = { byId: new Map(), byName: new Map(), byDexCode: new Map() }))
    let set = lang.byId.get(id)
    if (!set) {
      lang.byId.set(id, (set = { id, cards: new Map() }))
      const key = setKey(p.setName)
      lang.byName.set(key, lang.byName.has(key) ? null : set)
      lang.byDexCode.set(dexCode(id), set)
    }
    const number = numberKey(p.sourceId.slice(dash + 1))
    const rows = set.cards.get(number)
    if (rows) rows.push(p)
    else set.cards.set(number, [p])
  }
  return languages
}

/** The Dex id's set part: "swsh12pt5gg-GG01" to "swsh12pt5gg". */
const dexSetId = (id: string): string => id.slice(0, Math.max(id.lastIndexOf('-'), 0))

/** The row's set: by id and name when both know it (they must agree), else null. */
function findSet(row: DexRow, language: string, index: LanguageIndex): CatalogSet | null {
  if (REGIONAL.test(row.set)) return null
  const dexId = dexSetId(row.id)
  const named = index.byName.get(setKey(row.set, row.series)) ?? null
  // Each language's ids are its own; one with no table has only the name to go on.
  const pinned = language === 'en' ? DEX_SETS[dexId] : language === 'ja' ? DEX_JA_SETS[dexId] : undefined
  if (language === 'zh-hans' && dexId.startsWith('scn_')) {
    const set = index.byDexCode.get(dexId.slice(4).toLowerCase().replace(/\./g, ''))
    if (set) return named && named !== set ? null : set
  }
  if (pinned) {
    const set = index.byId.get(pinned) ?? null
    return named && named !== set ? null : set
  }
  const sameId = index.byId.get(dexId)
  return named && sameId && sameId !== named ? null : named
}

/** The printing for a row's card and variant, or why there isn't one. */
function findPrinting(
  row: DexRow,
  index: LanguageIndex | undefined,
  language: string
): DexCatalogPrinting | DexMissReason {
  const set = index && findSet(row, language, index)
  if (!set) return index ? 'set' : 'language'
  const printed = numberKey(row.number)
  const pinned = language === 'en' ? DEX_NUMBERS[dexSetId(row.id)] : undefined
  const number = pinned ? pinned[printed] : printed
  const versions = number === undefined ? undefined : set.cards.get(number)
  if (!versions) return 'number'
  const same = (p: DexCatalogPrinting): boolean =>
    sameCard(row.name, p.cardName) || (language === 'zh-hans' && sameWords(row.name, p.cardName))
  if (!versions.every(same)) return 'name'
  if (row.variant === 'Expansion Stamp') {
    const stamped = versions.filter((p) => STAMPED.has(p.version))
    return stamped.length === 1 ? stamped[0] : 'finish'
  }
  const dexSet = dexSetId(row.id)
  const finish = SET_FINISHES[dexSet]?.[row.variant] ?? FINISHES[row.variant]
  const exact = versions.find((p) => p.version === finish)
  if (exact) return exact
  return ONE_FINISH_SETS.has(dexSet) && versions.length === 1 ? versions[0] : 'finish'
}

export const dexMissing = (row: DexRow, reason: DexMissReason): DexMissing => ({
  name: row.name,
  set: row.set,
  number: row.number,
  variant: row.variant,
  locale: row.locale,
  quantity: row.quantity ?? 0,
  reason
})

/**
 * Maps export rows to printings. The same Id + Variant + Locale in several rows is one holding, so
 * it counts once at its highest quantity: Dex repeats a card in every list that holds it.
 */
export function matchDexRows(rows: DexRow[], catalog: DexCatalogPrinting[]): DexMatch {
  const index = indexCatalog(catalog)
  const held = new Map<string, DexRow>()
  const missing: DexMissing[] = []
  let zeroRows = 0
  let repeatRows = 0
  const miss = (row: DexRow, reason: DexMissReason): void =>
    void missing.push(dexMissing(row, reason))
  for (const row of rows) {
    if (row.quantity === null) miss(row, 'quantity')
    else if (row.quantity === 0) zeroRows++
    else {
      const key = `${row.id}\u0000${row.variant}\u0000${row.locale}`
      const seen = held.get(key)
      if (seen) repeatRows++
      if (!seen || (seen.quantity ?? 0) < row.quantity) held.set(key, row)
    }
  }
  const wanted: DexMatch['wanted'] = new Map()
  for (const row of held.values()) {
    const language = LOCALES[row.locale]
    const found = language ? findPrinting(row, index.get(language), language) : 'language'
    if (typeof found === 'string') miss(row, found)
    else {
      const quantity = Math.max(row.quantity ?? 0, wanted.get(found.id)?.quantity ?? 0)
      wanted.set(found.id, { cardId: found.cardId, quantity, row })
    }
  }
  return { wanted, missing, zeroRows, repeatRows }
}
