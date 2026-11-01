import { hasNativeScript } from '../../../src/shared/setNames'
import { getJson, type GetJsonOpts } from './http'
import { CHINESE_SET_NAMES } from './chineseNames'
import type { TdCard, TdSet, TdVariant } from './types'
import { GENERATED_VARIANT_ID } from './versions'

/**
 * Simplified Chinese printings, from zsjy947/PTCG-card-data (CC0; it compiles tcg.mik.moe's lists).
 * The files are pinned to a commit: its sets were checked against a real Dex export, and a new copy
 * shouldn't change the catalog unseen. The list has no art, prices or finishes; see listFinishes.
 */
const LIST_URL =
  'https://raw.githubusercontent.com/zsjy947/PTCG-card-data/7079b17a6844ea089b00d16d69e7060fc116911c/data'

export interface ZhCard {
  cardIndex: string
  cardName: string
  rarity: string
  cardType: string
  nameEn?: string
  /** The English card of the same rules, by its PTCGL code and number. */
  setCodeEn?: string
  cardIndexEn?: string
  /** The list's tags: stage, and the mechanics ("ex", "VSTAR", "Radiant"). */
  is?: string[]
}

/** One row of the list's sets_index.json. */
export interface ZhSetEntry {
  id: string
  code: string
  series: string
  count: number | null
}

/** The list's letter codes after 165, in the printed order 166 to 176. */
const LETTER_CARDS = ['R', 'G', 'B', 'GRA', 'FIR', 'WAT', 'LIG', 'PSY', 'FIG', 'DAR', 'MET']
const FIRST_LETTER_NUMBER = 166

/** 无标记 ("no mark") is left out: the card has a rarity, the list just doesn't say which. */
const RARITIES: Record<string, string> = {
  C: 'Common',
  R: 'Rare',
  RR: 'Double rare',
  AR: 'Illustration rare',
  SAR: 'Special illustration rare',
  FUR: 'Futuristic Rare',
  RGB: 'RGB Rare'
}

/** The printed number, three digits: "001", and R (the red Mew) is "166". */
function localId(index: string): string | null {
  if (/^\d+$/.test(index)) return index.padStart(3, '0')
  const i = LETTER_CARDS.indexOf(index)
  return i < 0 ? null : String(FIRST_LETTER_NUMBER + i)
}

/** The list's English name is the species alone on some cards; the Chinese name keeps the tag. */
function englishName(card: ZhCard): string {
  const en = (card.nameEn ?? '').trim()
  const named = en.charAt(0).toUpperCase() + en.slice(1)
  const tag = /(ex|EX|GX|LV\.X)$/.exec(card.cardName)?.[1]
  return tag && !named.replace(/-/g, ' ').endsWith(tag) ? `${named} ${tag}` : named
}

function categoryOf(cardType: string): string {
  if (cardType === 'Pokemon') return 'Pokemon'
  return /Energy$/.test(cardType) ? 'Energy' : 'Trainer'
}

/** The card's link to its English twin, when the list gives one. */
function englishTwinOf(row: ZhCard, mark: string): TdCard['englishTwin'] {
  const setCode = row.setCodeEn?.trim()
  const number = row.cardIndexEn?.trim()
  return setCode && number ? { setCode, number, mark } : undefined
}

const SET = { id: '30thC', name: '30th Celebration' }

/** The set and its cards. Every card of the set is holo, so the one finish is recorded as known. */
export function chineseSet(rows: ZhCard[]): { set: TdSet; cards: TdCard[] } {
  const cards = rows.map((row): TdCard => {
    const id = localId(row.cardIndex)
    if (!id || !row.nameEn) throw new Error(`Chinese list: can't read card ${row.cardIndex}`)
    return {
      id: `${SET.id}-${id}`,
      localId: id,
      name: englishName(row),
      localName: row.cardName,
      category: categoryOf(row.cardType),
      rarity: RARITIES[row.rarity] ?? null,
      variants_detailed: [{ type: 'holo' }],
      englishTwin: englishTwinOf(row, row.rarity),
      set: SET
    }
  })
  return {
    set: {
      ...SET,
      abbreviation: { official: SET.id },
      cardCount: { official: 103, total: cards.length },
      cards: cards.map((c) => ({ id: c.id, localId: c.localId, name: c.name }))
    },
    cards
  }
}

/** Rarities only this path sees; the star marks are the Gem Packs', as Dex reads them. */
const LIST_RARITIES: Record<string, string> = {
  ...RARITIES,
  U: 'Uncommon',
  RRR: 'Triple rare',
  SR: 'Super rare',
  SSR: 'Shiny ultra rare',
  HR: 'Hyper rare',
  UR: 'Ultra Rare',
  S: 'Shiny rare',
  A: 'Amazing rare',
  K: 'Radiant rare',
  ACE: 'ACE SPEC rare',
  PR: 'Prism Star rare',
  CHR: 'Character rare',
  CSR: 'Character super rare',
  '●': 'Common',
  '◆': 'Uncommon',
  '★': 'Rare',
  '★★': 'Double rare',
  '★★★': 'Triple rare'
}

const BALL = 'Poke Ball Pattern'
const MASTER = 'Master Ball Pattern'
const STARLIGHT = 'Starlight Holo'
const STAMPED = 'Set Logo Holofoil'

/**
 * The sets whose C, U and R a Dex export shows in a mirror, and the mirror. The other sets get none:
 * nothing says they lack one, but a missing version is better than a made-up one, and adding
 * versions later moves no key. Master Ball mirrors of these sets aren't here either: the export has
 * too few to say which cards have one.
 */
const MIRRORS: Record<string, string> = {
  CS2aC: 'reverse',
  CS2bC: 'reverse',
  '151C': BALL,
  CSV5C: BALL,
  CSV6C: BALL,
  CSV8C: BALL,
  CSV9C: BALL,
  CSV10C: BALL
}

/**
 * A Gem Pack gives each finish of a card its own number, so one mark can cover several finishes. By
 * set, mark and the number's last two digits, as a Dex export shows them. CBB1C has no rows, nor
 * has CBB3C beyond its ball cards, and CBB5C none in the first ◆; all of these stay plain Holofoil.
 */
const GEM_SLOTS: Record<string, Record<string, Record<number, string>>> = {
  CBB2C: {
    '●': { 3: BALL, 4: BALL },
    '◆': { 5: STARLIGHT, 6: STARLIGHT },
    '★': { 9: MASTER, 10: MASTER }
  },
  CBB3C: { '●': { 2: BALL } },
  CBB4C: { '●': { 2: BALL }, '◆': { 3: STARLIGHT }, '★': { 5: MASTER } },
  CBB5C: { '●': { 2: BALL }, '★': { 5: MASTER } },
  CBB6C: { '●': { 2: BALL }, '★': { 5: MASTER } }
}

/** Gem Packs whose ★★ are all Dex's "Expansion Stamp". */
const STAMPED_GEMS = new Set(['CBB2C', 'CBB4C', 'CBB5C', 'CBB6C'])

/** Deck and box cards have no mark; these tags are foil there too. */
const FOIL_TAGS = new Set(['V', 'VMAX', 'VSTAR', 'V-UNION', 'GX', 'TAG TEAM', 'ex', 'EX', 'BREAK Evolution', 'Level Up', 'LEGEND', 'Prism Star', 'Radiant', 'ACE SPEC', 'SP', 'Mega', 'Mega Evolution'])

/**
 * A card's finishes, from the rules a Dex export bears out (the list has none): C and U are Normal,
 * every other mark is Holofoil, no mark is Normal unless a foil tag says otherwise, and a mirror or
 * Gem Pack slot is added only as the tables above say. Basic Energy has no mirror, nor has any
 * Energy in the ball sets, whose exports show none. These are rules rather than a source, so they
 * are marked as generated and the job counts the cards as unverified.
 */
function listFinishes(setId: string, row: ZhCard): string[] {
  if (/^[●◆★]+$/.test(row.rarity)) {
    const slot = Number(row.cardIndex.slice(-2))
    const named = GEM_SLOTS[setId]?.[row.rarity]?.[slot]
    if (named) return [named]
    return [row.rarity === '★★' && STAMPED_GEMS.has(setId) ? STAMPED : 'holo']
  }
  if (row.rarity === '无标记') return row.is?.some((t) => FOIL_TAGS.has(t)) ? ['holo'] : ['normal']
  const base = row.rarity === 'C' || row.rarity === 'U' ? 'normal' : 'holo'
  const mirror = MIRRORS[setId]
  const mirrored =
    mirror &&
    ['C', 'U', 'R'].includes(row.rarity) &&
    row.cardType !== 'Basic Energy' &&
    !(mirror === BALL && /Energy$/.test(row.cardType))
  return mirrored ? [base, mirror] : [base]
}

/** Marks the list has wrong, by set and number, as a Dex export shows them. */
const RARITY_FIXES: Record<string, Record<string, string>> = {
  CSV5C: { '035': 'U', '037': 'U', '038': 'R', '054': 'U', '074': 'R', '083': 'R', '092': 'R', '098': 'R', '103': 'R' }
}

/** The letter codes the list uses for energy and the like, kept as they are printed. */
const LETTER_INDEX = new Set([...LETTER_CARDS, 'FAI'])

/** English names the list lacks or has wrong, by Chinese name. */
const NAME_FIXES: Record<string, string> = {
  '船长 皮卡丘': 'Captain Pikachu',
  // The list calls this one Cosmoem.
  沙漠蜻蜓GX: 'Flygon GX'
}

/** "冰伊布GX" to "冰伊布", and the same for the other tags a name can end in. */
const untagged = (name: string): string => name.replace(/\s*(ex|EX|GX|LV\.X)$/, '')

/** The list's nameEn, without the zero-width spaces some rows have. */
const cleanEn = (card: ZhCard): string => (card.nameEn ?? '').replace(/\u200b/g, '').trim()

/** English names by Chinese name, from every row that has one, the first row winning. */
function chineseNamer(rows: ZhCard[]): (name: string) => string | undefined {
  const names = new Map<string, string>()
  for (const row of rows) {
    const en = cleanEn(row)
    if (!en || hasNativeScript(en)) continue
    if (!names.has(row.cardName)) names.set(row.cardName, en)
  }
  return (name) => names.get(name)
}

export interface ChineseListResult {
  sets: { set: TdSet; cards: TdCard[] }[]
  /** Cards with no English name of their own, and those of them no row could name. */
  named: number
  unnamed: number
  /** Cards whose number isn't a number or known letter code, and rows left out for repeating one. */
  oddNumbers: number
  repeats: number
}

/**
 * Every set of the list but 30th Celebration, which chineseSet builds: `rows` has each file by id.
 * An odd number is kept as printed and a card no one names takes its set and number, so nothing is
 * dropped and no Chinese name reaches `name`; the counts go to the job's log.
 */
export function chineseListSets(index: ZhSetEntry[], rows: Map<string, ZhCard[]>): ChineseListResult {
  const out: ChineseListResult = { sets: [], named: 0, unnamed: 0, oddNumbers: 0, repeats: 0 }
  const nameOf = chineseNamer([...rows.values()].flat())
  for (const [id, entry] of chineseFiles(index)) {
    const list = rows.get(id)
    if (!list || id === SET.id) continue
    const ref = { id, name: CHINESE_SET_NAMES[id] ?? id }
    const seen = new Set<string>()
    const cards: TdCard[] = []
    list.forEach((row, i) => {
      const number = row.cardIndex.replace(/[^A-Za-z0-9]/g, '')
      const rarity = RARITY_FIXES[id]?.[number] ?? row.rarity
      if (!/^\d+$/.test(number) && !LETTER_INDEX.has(number)) out.oddNumbers++
      const localId = number || `X${i + 1}`
      if (seen.has(localId)) return void out.repeats++
      seen.add(localId)
      // The list calls some GX cards "Glaceon V"; englishName puts the right tag back.
      const raw = cleanEn(row)
      const own = /GX$/.test(row.cardName) ? raw.replace(/ V$/, '') : raw
      let en = NAME_FIXES[row.cardName] ?? (hasNativeScript(own) ? '' : own)
      if (!en) {
        out.named++
        en = nameOf(row.cardName) ?? nameOf(untagged(row.cardName)) ?? ''
      }
      if (!en) out.unnamed++
      const name = en ? englishName({ ...row, nameEn: en }) : `${id} ${localId}`
      cards.push({
        id: `${id}-${localId}`,
        localId,
        name,
        localName: row.cardName,
        category: categoryOf(row.cardType),
        rarity: LIST_RARITIES[rarity] ?? null,
        variants_detailed: listFinishes(id, { ...row, rarity }).map(
          (type): TdVariant => ({ type, variantId: GENERATED_VARIANT_ID })
        ),
        englishTwin: englishTwinOf(row, rarity),
        set: ref
      })
    })
    out.sets.push({
      set: {
        ...ref,
        serie: { id: entry.series },
        abbreviation: { official: id },
        cardCount: { total: cards.length },
        cards: cards.map((c) => ({ id: c.id, localId: c.localId, name: c.name }))
      },
      cards
    })
  }
  return out
}

/**
 * The list's card files by id, with their index row. Promo rows have no file. The four waves of
 * Collection 151 share a code and one file, which holds all 192 numbers; each wave's own file is
 * just that file's rows, so the catalog has the one set, as Dex does.
 */
export function chineseFiles(index: ZhSetEntry[]): Map<string, ZhSetEntry> {
  const files = new Map<string, ZhSetEntry>()
  for (const s of index) {
    if (s.id === 'PROMO' || !s.count) continue
    const id = s.id.startsWith(`${s.code}-`) ? s.code : s.id
    if (!files.has(id)) files.set(id, s)
  }
  return files
}

export const chineseIndex = (o: GetJsonOpts): Promise<ZhSetEntry[]> =>
  getJson(`${LIST_URL}/sets_index.json`, o)

export const chineseCards = (id: string, o: GetJsonOpts): Promise<ZhCard[]> =>
  getJson(`${LIST_URL}/cards/${id}.json`, o)
