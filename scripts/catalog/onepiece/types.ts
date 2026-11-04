export type OpSeriesKind = 'booster' | 'deck' | 'promo' | 'other'

/** One entry of the series <select> on Bandai's card list page. */
export interface BandaiSeries {
  id: string
  kind: OpSeriesKind
  title: string
  code: string
  setName: string
  setCode: string
}

/** One card block (`<dl class="modalCol">`) on Bandai's card list page. */
export interface BandaiEntry {
  bandaiId: string
  number: string
  rarity: string
  cardType: string
  name: string
  cost: number | null
  life: number | null
  power: number | null
  counter: number | null
  colors: string[]
  attribute: string[]
  traits: string[]
  block: number | null
  effect: string | null
  trigger: string | null
  cardSets: string
  seriesId: string
}
