import { languageInfo } from '../languages'
import type { GameDef } from './types'

export const PKM: GameDef = {
  id: 'pkm',
  name: 'Pokémon',
  features: { scan: false, rip: false },
  crossLanguagePriceFallback: false,
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
    { key: 'hp', label: 'HP', kind: 'range' }
  ]
}
