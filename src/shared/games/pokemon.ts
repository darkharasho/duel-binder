import { languageInfo } from '../languages'
import type { GameDef } from './types'

export const PKM: GameDef = {
  id: 'pkm',
  name: 'Pokémon',
  color: '#e0483d',
  features: { scan: true, rip: false },
  // TCGdex's card images, most of the catalog's art, are 600×825 (low: 245×337). Its TCGplayer
  // fallbacks are a little narrower (about 716×1000), so they lose a sliver top and bottom.
  cardAspect: { width: 600, height: 825 },
  crossLanguagePriceFallback: false,
  priceRule: 'marketOnly',
  access: 'everyone',
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
    { key: 'localName', label: 'Local name' }
  ]
}
