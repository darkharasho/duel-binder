import { languageInfo } from '../languages'
import type { GameDef } from './types'

export const PKM: GameDef = {
  id: 'pkm',
  name: 'Pokémon',
  color: '#e0483d',
  features: { scan: false, rip: false },
  crossLanguagePriceFallback: false,
  priceRule: 'marketOnly',
  access: 'owner',
  vocab: {
    cardId: 'Card',
    printingCode: 'Number',
    rarity: 'Version',
    regionLabel: (lang) => languageInfo(lang).label
  },
  filters: [
    { key: 'pkmCategories', label: 'Category', kind: 'multi' },
    { key: 'pkmTypes', label: 'Type', kind: 'multi' },
    { key: 'pkmStages', label: 'Stage', kind: 'multi' },
    { key: 'pkmRarities', label: 'Rarity', kind: 'multi' },
    { key: 'hp', label: 'HP', kind: 'range' }
  ],
  details: [
    { key: 'category', label: 'Category' },
    { key: 'hp', label: 'HP' },
    { key: 'types', label: 'Type' },
    { key: 'stage', label: 'Stage' },
    { key: 'rarity', label: 'Rarity' },
    { key: 'illustrator', label: 'Illustrator' },
    { key: 'localName', label: 'Japanese name' }
  ]
}
