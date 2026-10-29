import { languageInfo } from '../languages'
import type { GameDef } from './types'

export const YGO: GameDef = {
  id: 'ygo',
  name: 'Yu-Gi-Oh!',
  features: { scan: true, rip: true },
  crossLanguagePriceFallback: true,
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
  ]
}
