import { getJson, type GetJsonOpts } from './http'
import type { TdCard, TdSet } from './types'

/**
 * Simplified Chinese printings, from zsjy947/PTCG-card-data (CC0; it compiles tcg.mik.moe's lists).
 * The file is pinned to a commit: this one set was checked against a real Dex export, every card by
 * number and name, and a new copy shouldn't change the catalog unseen. The list has no art, prices
 * or finishes, and only this set so far: its other 139 have no checked English set names.
 */
const CARDS_URL =
  'https://raw.githubusercontent.com/zsjy947/PTCG-card-data/7079b17a6844ea089b00d16d69e7060fc116911c/data/cards/30thC.json'

export interface ZhCard {
  cardIndex: string
  cardName: string
  rarity: string
  cardType: string
  nameEn?: string
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

export const chineseCards = (o: GetJsonOpts): Promise<ZhCard[]> => getJson(CARDS_URL, o)
