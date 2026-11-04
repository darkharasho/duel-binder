import { languageInfo } from '../languages'
import type { GameDef } from './types'

export const OP_CARD_TYPES = ['Leader', 'Character', 'Event', 'Stage', 'DON!!'] as const
export const OP_RARITIES = ['L', 'C', 'UC', 'R', 'SR', 'SEC', 'SP', 'TR', 'P'] as const
export const OP_ATTRIBUTES = ['Strike', 'Slash', 'Ranged', 'Special', 'Wisdom'] as const

export const ONE_PIECE: GameDef = {
  id: 'op',
  name: 'One Piece',
  color: '#3b82c4',
  features: { scan: false, rip: false },
  cardAspect: { width: 600, height: 838 },
  crossLanguagePriceFallback: false,
  priceRule: 'marketOnly',
  access: 'testers',
  vocab: {
    cardId: 'Card',
    printingCode: 'Card number',
    rarity: 'Rarity',
    regionLabel: (lang) => languageInfo(lang).label
  },
  filters: [
    { key: 'opColors', label: 'Color', kind: 'multi' },
    { key: 'opCardTypes', label: 'Card type', kind: 'multi' },
    { key: 'opAttributes', label: 'Attribute', kind: 'multi' },
    { key: 'opTraits', label: 'Trait', kind: 'multi' },
    { key: 'opRarities', label: 'Rarity', kind: 'multi' },
    { key: 'opBlocks', label: 'Block', kind: 'multi' },
    { key: 'cost', label: 'Cost', kind: 'range' },
    { key: 'power', label: 'Power', kind: 'range' },
    { key: 'counter', label: 'Counter', kind: 'range' }
  ],
  details: [
    { key: 'cardType', label: 'Card type' },
    { key: 'colors', label: 'Color' },
    { key: 'cost', label: 'Cost' },
    { key: 'life', label: 'Life' },
    { key: 'power', label: 'Power' },
    { key: 'counter', label: 'Counter' },
    { key: 'attribute', label: 'Attribute' },
    { key: 'traits', label: 'Traits' },
    { key: 'blockIcon', label: 'Block' },
    { key: 'number', label: 'Card number' }
  ]
}
