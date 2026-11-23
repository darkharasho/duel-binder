import type { PkmRulesPack } from '../pack'
import type { DeckCard } from '../types'
import { normalCardName } from '../names'

export type KeyHit = { key: number } | { unsure: number[] } | { none: true }
export interface KeyIndex {
  byName: Map<string, number[]>
}

export function keyIndex(pack: PkmRulesPack): KeyIndex {
  const byName = new Map<string, number[]>()
  pack.keys.forEach((k, i) => {
    const n = normalCardName(k.n)
    const list = byName.get(n)
    if (list) list.push(i)
    else byName.set(n, [i])
  })
  return { byName }
}

/** A card's rules key: by its TCGdex id when the pack knows it, else by its English name. */
export function keyOfCard(card: DeckCard, pack: PkmRulesPack, index: KeyIndex): KeyHit {
  if (card.sourceId) {
    const slash = card.sourceId.indexOf('/')
    const key = pack.ids[card.sourceId.slice(slash + 1)]
    if (key !== undefined) return { key }
  }
  const hits = index.byName.get(normalCardName(card.name))
  if (!hits || hits.length === 0) return { none: true }
  if (hits.length === 1) return { key: hits[0] }
  return { unsure: [...hits].sort((a, b) => a - b) }
}

const KINDS: Record<string, 'P' | 'T' | 'E'> = {}
const add = (k: 'P' | 'T' | 'E', words: string[]): void => {
  for (const w of words) KINDS[normalCardName(w)] = k
}
add('P', ['Pokemon', 'Pokémon', 'ポケモン', '宝可梦', '寶可夢'])
add('T', [
  'Trainer',
  'Dresseur',
  'Allenatore',
  'Entrenador',
  'Treinador',
  'トレーナーズ',
  '训练家',
  '訓練家'
])
add('E', ['Energy', 'Énergie', 'Energie', 'Energia', 'Energía', 'エネルギー', '能量'])

export function pkmKind(type: string): 'P' | 'T' | 'E' | null {
  return KINDS[normalCardName(type)] ?? null
}
