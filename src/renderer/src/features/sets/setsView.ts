import type { ChecklistCard, CountMode, SetChecklist, SetSummary } from '@shared/types'

export type SetFilter = 'started' | 'all' | 'complete'
export type SetSort = 'complete' | 'name' | 'date'
export type TileFilter = 'all' | 'owned' | 'missing'

export interface Progress {
  owned: number
  total: number
  percent: number
  complete: boolean
}

export interface Tile {
  key: string
  card: ChecklistCard
  rarity: string | null
  owned: number
  entryId: number | null
}

export function progressFor(s: SetSummary, mode: CountMode): Progress {
  const owned = mode === 'cards' ? s.ownedCards : s.ownedRarities
  const total = mode === 'cards' ? s.totalCards : s.totalRarities
  return {
    owned,
    total,
    percent: total > 0 ? Math.floor((owned / total) * 100) : 0,
    complete: total > 0 && owned === total
  }
}

export function setsHeader(
  sets: SetSummary[],
  mode: CountMode
): { started: number; total: number; complete: number } {
  let started = 0
  let complete = 0
  for (const s of sets) {
    const p = progressFor(s, mode)
    if (p.owned > 0) started++
    if (p.complete) complete++
  }
  return { started, total: sets.length, complete }
}

export function filterSets(
  sets: SetSummary[],
  o: { filter: SetFilter; q: string; mode: CountMode }
): SetSummary[] {
  const q = o.q.trim().toLowerCase()
  return sets.filter((s) => {
    const p = progressFor(s, o.mode)
    if (o.filter === 'started' && p.owned === 0) return false
    if (o.filter === 'complete' && !p.complete) return false
    return !q || s.setName.toLowerCase().includes(q) || s.setCode.toLowerCase().includes(q)
  })
}

export function sortSets(sets: SetSummary[], sort: SetSort, mode: CountMode): SetSummary[] {
  const byName = (a: SetSummary, b: SetSummary): number => a.setName.localeCompare(b.setName)
  const out = [...sets]
  if (sort === 'name') return out.sort(byName)
  if (sort === 'date') {
    return out.sort((a, b) => {
      if (a.tcgDate === b.tcgDate) return byName(a, b)
      if (a.tcgDate === null) return 1
      if (b.tcgDate === null) return -1
      return a.tcgDate < b.tcgDate ? 1 : -1
    })
  }
  return out.sort((a, b) => {
    const pa = progressFor(a, mode)
    const pb = progressFor(b, mode)
    return pb.percent - pa.percent || pb.owned - pa.owned || byName(a, b)
  })
}

export function checklistTiles(cl: SetChecklist, mode: CountMode): Tile[] {
  if (mode === 'cards') {
    return cl.cards.map((card) => ({
      key: String(card.cardId),
      card,
      rarity: null,
      owned: card.owned,
      entryId: card.entryId
    }))
  }
  return cl.cards.flatMap((card) =>
    card.rarities.map((r) => ({
      key: `${card.cardId}|${r.rarity}`,
      card,
      rarity: r.rarity,
      owned: r.owned,
      entryId: r.entryId
    }))
  )
}

export function filterTiles(tiles: Tile[], f: TileFilter): Tile[] {
  if (f === 'owned') return tiles.filter((t) => t.owned > 0)
  if (f === 'missing') return tiles.filter((t) => t.owned === 0)
  return tiles
}
