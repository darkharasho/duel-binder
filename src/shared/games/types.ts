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

export interface CardAspect {
  width: number
  height: number
}

/** The aspect as a CSS ratio (`aspect-ratio`) or ratio expression (inside `calc()`), e.g. `421 / 614`. */
export const cssAspect = (a: CardAspect): string => `${a.width} / ${a.height}`

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
  /**
   * The card art's width and height, in the proportion the game's card images are served at: every
   * art frame takes this aspect, so the picture fills it without being cut off.
   */
  cardAspect: CardAspect
  crossLanguagePriceFallback: boolean
  /** 'ygo': market, eBay, twin and set-price fallbacks. 'marketOnly': the printing's own market price, any language. */
  priceRule: 'ygo' | 'marketOnly'
  access: 'everyone' | 'owner'
  vocab: GameVocab
  filters: FilterDef[]
  /** The card facts the details panel lists, in order, as keys of the card's game-specific facts. */
  details: { key: string; label: string }[]
}
