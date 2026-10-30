import { languageInfo } from '../languages'
import type { GameDef } from './types'

export const YGO: GameDef = {
  id: 'ygo',
  name: 'Yu-Gi-Oh!',
  color: '#c9a24b',
  features: { scan: true, rip: true },
  // YGOPRODeck's card images are 421×614.
  cardAspect: { width: 421, height: 614 },
  crossLanguagePriceFallback: true,
  priceRule: 'ygo',
  access: 'everyone',
  vocab: {
    cardId: 'Passcode',
    printingCode: 'Set code',
    rarity: 'Rarity',
    // Languages whose Yugipedia list suffix is OCG-* are OCG; English and the European ones are TCG.
    regionLabel: (lang) => (languageInfo(lang).yugipediaSuffix?.startsWith('OCG') ? 'OCG' : 'TCG')
  },
  filters: [
    { key: 'cardTypes', label: 'Type', kind: 'multi' },
    { key: 'attributes', label: 'Attribute', kind: 'multi' },
    { key: 'races', label: 'Race', kind: 'multi' },
    { key: 'archetypes', label: 'Archetype', kind: 'multi' },
    { key: 'level', label: 'Level', kind: 'range' }
  ],
  // Yu-Gi-Oh!'s facts are its stats line, which the card panel builds itself.
  details: []
}
