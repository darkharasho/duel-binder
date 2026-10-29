import type { Language } from '../languages'

export type GameId = 'ygo' | 'pkm'

export const GAME_IDS: readonly GameId[] = ['ygo', 'pkm']

/** The UI words that differ per game. */
export interface GameVocab {
  cardId: string
  printingCode: string
  rarity: string
  regionLabel(lang: Language): string
}

export interface FilterDef {
  key: string
  label: string
  kind: 'multi' | 'range'
}

export interface GameDef {
  id: GameId
  name: string
  /** The game's dot in the game switch. */
  color: string
  features: { scan: boolean; rip: boolean }
  crossLanguagePriceFallback: boolean
  access: 'everyone' | 'owner'
  vocab: GameVocab
  filters: FilterDef[]
}
