import { packKeyOfId, type PkmRulesPack } from '../pack'
import type { DeckCard } from '../types'
import { normalCardName, trainerBaseName } from '../names'
import { PKM_FLAG } from '../pack'

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
    const key = packKeyOfId(pack, card.sourceId.slice(slash + 1))
    if (key !== undefined) return { key }
  }
  const kind = pkmKind(card.type)
  let name = normalCardName(kind === 'T' ? trainerBaseName(card.name) : card.name)
  // Japanese and Traditional Chinese catalogs name basic Energy "Basic Water Energy"; TCGdex's
  // English name is "Water Energy", which old sets also give a Special Energy.
  const basic = kind === 'E' && name.startsWith('basic ')
  if (basic) name = name.slice('basic '.length)
  let hits = index.byName.get(name)
  if (basic && hits) {
    const flagged = hits.filter((i) => (pack.keys[i].f & PKM_FLAG.basicEnergy) !== 0)
    if (flagged.length > 0) hits = flagged
  }
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
