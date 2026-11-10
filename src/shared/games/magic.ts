import { languageInfo } from '../languages'
import type { GameDef } from './types'

export const MTG_RARITIES = ['Common', 'Uncommon', 'Rare', 'Mythic', 'Special', 'Bonus'] as const

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
  // Stubs: the page filters ignore keys they have no field or SQL for (facetsFor reads GAME_KEYS,
  // rangeFilters reads RANGE_FIELDS). Step 2 wires the fields and the SQL.
  filters: [
    { key: 'mtgColors', label: 'Color', kind: 'multi' },
    { key: 'mtgTypes', label: 'Type', kind: 'multi' },
    { key: 'mtgRarities', label: 'Rarity', kind: 'multi' },
    { key: 'mtgFinishes', label: 'Finish', kind: 'multi' },
    { key: 'mtgSetTypes', label: 'Set type', kind: 'multi' },
    { key: 'manaValue', label: 'Mana value', kind: 'range' },
    { key: 'mtgPower', label: 'Power', kind: 'range' },
    { key: 'mtgToughness', label: 'Toughness', kind: 'range' }
  ],
  // Keys mirror the mtg_cards columns (Task 2).
  details: [
    { key: 'typeLine', label: 'Type' },
    { key: 'manaCost', label: 'Mana cost' },
    { key: 'manaValue', label: 'Mana value' },
    { key: 'colors', label: 'Color' },
    { key: 'oracleText', label: 'Rules text' },
    { key: 'power', label: 'Power' },
    { key: 'toughness', label: 'Toughness' },
    { key: 'loyalty', label: 'Loyalty' },
    { key: 'defense', label: 'Defense' },
    { key: 'artist', label: 'Artist' },
    { key: 'setNumber', label: 'Set & number' }
  ]
}
