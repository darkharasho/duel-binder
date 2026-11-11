import { languageInfo, type Language } from '../languages'
import type { GameDef } from './types'

export const MTG_RARITIES = ['Common', 'Uncommon', 'Rare', 'Mythic', 'Special', 'Bonus'] as const

/** Card types `mtg_cards.types` can hold, in the order they are listed; `cards.type` is the first present. */
export const MTG_CARD_TYPES = [
  'Artifact',
  'Battle',
  'Creature',
  'Enchantment',
  'Instant',
  'Kindred',
  'Land',
  'Planeswalker',
  'Sorcery',
  'Tribal',
  'Token',
  'Emblem',
  'Dungeon',
  'Conspiracy',
  'Plane',
  'Phenomenon',
  'Scheme',
  'Vanguard'
] as const

/** Scryfall's printed-language codes the app carries, mapped to app languages. Others (Phyrexian, Quenya) are skipped. */
export const MTG_LANGUAGES: Readonly<Record<string, Language>> = {
  en: 'en',
  es: 'es',
  fr: 'fr',
  de: 'de',
  it: 'it',
  pt: 'pt',
  ja: 'ja',
  ko: 'ko',
  ru: 'ru',
  zhs: 'zh-hans',
  zht: 'zh-hant'
}

/**
 * `mtg_cards.local_name_search`: the printed name as a search compares it. SQLite's LIKE and lower()
 * fold ASCII only, so "молния" would never find "Молния"; the job writes this lowercased copy and a
 * search lowercases its text the same way. Latin and Cyrillic accents are dropped too, so "eclair"
 * finds "Éclair" and "ежик" finds "Ёжик". Only the combining diacritics block (U+0300–U+036F) goes:
 * Japanese voicing marks (U+3099) and Hangul jamo stay, or ガ would read as カ.
 */
export const magicNameSearchKey = (s: string): string =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').normalize('NFC').toLowerCase()

/** How many languages a Magic card can have (each its own card under the English name). */
export const MAGIC_LANGUAGE_COUNT = Object.keys(MTG_LANGUAGES).length

export const mtgLanguageOf = (scryLang: string): Language | null =>
  Object.hasOwn(MTG_LANGUAGES, scryLang) ? MTG_LANGUAGES[scryLang] : null

export const MTG_COLOR_NAMES = {
  W: 'White',
  U: 'Blue',
  B: 'Black',
  R: 'Red',
  G: 'Green'
} as const

export const MAGIC: GameDef = {
  id: 'mtg',
  name: 'Magic',
  color: '#c2410c',
  features: { scan: false, pokedex: false },
  cardAspect: { width: 488, height: 680 },
  crossLanguagePriceFallback: false,
  priceRule: 'marketOnly',
  access: 'testers',
  vocab: {
    cardId: 'Card',
    printingCode: 'Set & number',
    rarity: 'Rarity',
    regionLabel: (lang) => languageInfo(lang).label
  },
  // Rarity is the shared Rarity facet, which on Magic lists base rarities (finish apart).
  filters: [
    { key: 'mtgColors', label: 'Color', kind: 'multi' },
    { key: 'mtgTypes', label: 'Type', kind: 'multi' },
    { key: 'mtgFinishes', label: 'Finish', kind: 'multi' },
    { key: 'manaValue', label: 'Mana value', kind: 'range' },
    { key: 'mtgPower', label: 'Power', kind: 'range' },
    { key: 'mtgToughness', label: 'Toughness', kind: 'range' }
  ],
  // Keys mirror the mtg_cards columns; the printing's Set & number comes from the printing itself.
  details: [
    { key: 'typeLine', label: 'Type' },
    { key: 'localName', label: 'Printed name' },
    { key: 'manaCost', label: 'Mana cost' },
    { key: 'manaValue', label: 'Mana value' },
    { key: 'colors', label: 'Color' },
    { key: 'oracleText', label: 'Rules text' },
    { key: 'power', label: 'Power' },
    { key: 'toughness', label: 'Toughness' },
    { key: 'loyalty', label: 'Loyalty' },
    { key: 'defense', label: 'Defense' },
    { key: 'artist', label: 'Artist' }
  ]
}

/** A Magic printing's finish, read from its rarity text (`Rare (Foil)`, `Mythic (Etched Foil)`). */
export function finishOf(setRarity: string): 'nonfoil' | 'foil' | 'etched' {
  if (setRarity.endsWith(' (Etched Foil)')) return 'etched'
  if (setRarity.endsWith(' (Foil)')) return 'foil'
  return 'nonfoil'
}

/** SQL for a Magic printing's finish ('Nonfoil', 'Foil', 'Etched Foil') from the rarity text in `col`. */
export const mtgFinishSql = (col: string): string =>
  `CASE WHEN ${col} LIKE '% (Etched Foil)' THEN 'Etched Foil' WHEN ${col} LIKE '% (Foil)' THEN 'Foil' ELSE 'Nonfoil' END`

/** SQL for a Magic printing's base rarity: the rarity text in `col` without its finish suffix. */
export const mtgBaseRaritySql = (col: string): string =>
  `CASE WHEN ${col} LIKE '% (Etched Foil)' THEN substr(${col}, 1, length(${col}) - 14)
        WHEN ${col} LIKE '% (Foil)' THEN substr(${col}, 1, length(${col}) - 7) ELSE ${col} END`
