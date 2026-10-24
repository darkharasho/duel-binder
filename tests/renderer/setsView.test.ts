import type { ChecklistCard, SetChecklist, SetSummary } from '@shared/types'
import {
  checklistTiles,
  filterSets,
  filterTiles,
  progressFor,
  replaceChecklistCard,
  setsHeader,
  sortSets
} from '@/features/sets/setsView'
import { createSerialQueue } from '@/lib/serialQueue'
import { metalRaidersChecklist } from './setFixtures'

const mk = (o: Partial<SetSummary>): SetSummary => ({
  language: 'en',
  setName: 'Set',
  setCode: 'SET',
  tcgDate: null,
  imageKey: null,
  totalCards: 100,
  ownedCards: 0,
  totalRarities: 120,
  ownedRarities: 0,
  listRows: null,
  unmatchedRows: null,
  ...o
})

const complete = mk({
  setName: 'Legend of Blue Eyes',
  setCode: 'LOB',
  totalCards: 10,
  ownedCards: 10,
  tcgDate: '2002-03-08'
})
const started = mk({
  setName: 'Metal Raiders',
  setCode: 'MRD',
  totalCards: 10,
  ownedCards: 5,
  tcgDate: '2002-06-26'
})
const untouched = mk({
  setName: 'Spell Ruler',
  setCode: 'SRL',
  totalCards: 10,
  ownedCards: 0,
  tcgDate: null
})

describe('progressFor', () => {
  it('floors the percent', () => {
    expect(progressFor(mk({ totalCards: 144, ownedCards: 143 }), 'cards')).toEqual({
      owned: 143,
      total: 144,
      percent: 99,
      complete: false
    })
  })
  it('marks fully owned sets complete', () => {
    expect(progressFor(complete, 'cards')).toMatchObject({ percent: 100, complete: true })
  })
  it('handles empty sets', () => {
    expect(progressFor(mk({ totalCards: 0, ownedCards: 0 }), 'cards')).toMatchObject({
      percent: 0,
      complete: false
    })
  })
  it('uses rarity counts in rarities mode', () => {
    expect(progressFor(mk({ totalRarities: 4, ownedRarities: 2 }), 'rarities')).toMatchObject({
      owned: 2,
      total: 4,
      percent: 50
    })
  })
})

describe('setsHeader', () => {
  it('counts started and complete sets', () => {
    expect(setsHeader([complete, started, untouched], 'cards')).toEqual({
      started: 2,
      total: 3,
      complete: 1
    })
  })
})

describe('filterSets', () => {
  const all = [complete, started, untouched]
  it('started excludes untouched', () => {
    expect(filterSets(all, { filter: 'started', q: '', mode: 'cards' })).toEqual([
      complete,
      started
    ])
  })
  it('complete keeps only complete', () => {
    expect(filterSets(all, { filter: 'complete', q: '', mode: 'cards' })).toEqual([complete])
  })
  it('matches code case-insensitively', () => {
    expect(filterSets(all, { filter: 'all', q: 'mrd', mode: 'cards' })).toEqual([started])
  })
  it('matches name substring', () => {
    expect(filterSets(all, { filter: 'all', q: 'RAID', mode: 'cards' })).toEqual([started])
  })
})

describe('sortSets', () => {
  it('date puts newest first and null last', () => {
    const out = sortSets([untouched, complete, started], 'date', 'cards')
    expect(out.map((s) => s.setCode)).toEqual(['MRD', 'LOB', 'SRL'])
  })
  it('complete orders by percent then owned', () => {
    const a = mk({ setName: 'A', totalCards: 10, ownedCards: 5 })
    const b = mk({ setName: 'B', totalCards: 100, ownedCards: 50 })
    const out = sortSets([a, untouched, b, complete], 'complete', 'cards')
    expect(out.map((s) => s.setName)).toEqual(['Legend of Blue Eyes', 'B', 'A', 'Spell Ruler'])
  })
  it('name sorts alphabetically and does not mutate input', () => {
    const input = [untouched, complete]
    expect(sortSets(input, 'name', 'cards').map((s) => s.setCode)).toEqual(['LOB', 'SRL'])
    expect(input[0]).toBe(untouched)
  })
})

const alpha: ChecklistCard = {
  cardId: 1,
  name: 'Alpha',
  type: 'Normal Monster',
  number: 1,
  numberLabel: '001',
  imageId: 1,
  owned: 2,
  entryId: 7,
  rarities: [
    { rarity: 'Common', owned: 0, codes: [], defaultPrintingId: 1, entryId: null },
    { rarity: 'Rare', owned: 2, codes: [], defaultPrintingId: 2, entryId: 7 }
  ]
}
const checklist: SetChecklist = { set: started, cards: [alpha] }

describe('checklistTiles', () => {
  it('gives one tile per card in cards mode', () => {
    expect(checklistTiles(checklist, 'cards')).toEqual([
      { key: '1', card: alpha, rarity: null, owned: 2, entryId: 7 }
    ])
  })
  it('gives one tile per rarity in rarities mode', () => {
    const tiles = checklistTiles(checklist, 'rarities')
    expect(tiles.map((t) => t.key)).toEqual(['1|Common', '1|Rare'])
    expect(tiles[1]).toMatchObject({ rarity: 'Rare', owned: 2, entryId: 7 })
    expect(tiles[0]).toMatchObject({ owned: 0, entryId: null })
  })
})

describe('filterTiles', () => {
  const tiles = checklistTiles(checklist, 'rarities')
  it('missing drops owned tiles', () => {
    expect(filterTiles(tiles, 'missing').map((t) => t.rarity)).toEqual(['Common'])
  })
  it('owned keeps owned tiles', () => {
    expect(filterTiles(tiles, 'owned').map((t) => t.rarity)).toEqual(['Rare'])
  })
  it('all keeps everything', () => {
    expect(filterTiles(tiles, 'all')).toHaveLength(2)
  })
})

describe('createSerialQueue', () => {
  const deferred = (): { promise: Promise<void>; resolve: () => void } => {
    let resolve!: () => void
    const promise = new Promise<void>((res) => {
      resolve = res
    })
    return { promise, resolve }
  }

  it('runs tasks one at a time in order', async () => {
    const enqueue = createSerialQueue()
    const first = deferred()
    const order: number[] = []
    const p1 = enqueue(() => {
      order.push(1)
      return first.promise
    })
    const p2 = enqueue(async () => {
      order.push(2)
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(order).toEqual([1])
    first.resolve()
    await Promise.all([p1, p2])
    expect(order).toEqual([1, 2])
  })

  it('keeps going after a rejected task', async () => {
    const enqueue = createSerialQueue()
    const bad = enqueue(() => Promise.reject(new Error('boom')))
    const good = enqueue(async () => 'ok')
    await expect(bad).rejects.toThrow('boom')
    await expect(good).resolves.toBe('ok')
  })
})

describe('replaceChecklistCard', () => {
  it('replaces the card by id and recomputes owned counts, leaving totals', () => {
    const [alpha, beta, gamma] = metalRaidersChecklist.cards
    const newBeta: ChecklistCard = {
      ...beta,
      owned: 1,
      rarities: [{ ...beta.rarities[0], owned: 1 }]
    }
    const newAlpha: ChecklistCard = {
      ...alpha,
      owned: 3,
      rarities: [{ ...alpha.rarities[0], owned: 1 }, alpha.rarities[1]]
    }
    const once = replaceChecklistCard(metalRaidersChecklist, newBeta)
    expect(once.cards).toEqual([alpha, newBeta, gamma])
    expect(once.set).toEqual({ ...metalRaidersChecklist.set, ownedCards: 2, ownedRarities: 2 })
    const twice = replaceChecklistCard(once, newAlpha)
    expect(twice.set).toMatchObject({
      ownedCards: 2,
      ownedRarities: 3,
      totalCards: 3,
      totalRarities: 4
    })
    const zeroed = replaceChecklistCard(twice, {
      ...newAlpha,
      owned: 0,
      rarities: newAlpha.rarities.map((r) => ({ ...r, owned: 0 }))
    })
    expect(zeroed.set).toMatchObject({ ownedCards: 1, ownedRarities: 1 })
    expect(metalRaidersChecklist.set.ownedCards).toBe(1)
  })
})
