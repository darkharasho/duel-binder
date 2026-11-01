import type { ChecklistCard, SetChecklist, SetSummary } from '@shared/types'
import {
  adjustChecklistCard,
  bulkTiles,
  checklistTiles,
  filterBulkCards,
  checklistSorts,
  filterSets,
  filterTiles,
  filterTilesByRarity,
  rarityCounts,
  patchSetSummary,
  progressFor,
  replaceChecklistCard,
  setsHeader,
  sortCards,
  sortSets,
  sortTiles,
  type Tile,
  typeCounts,
  upcomingCutoff,
  isUpcoming,
  splitUpcoming
} from '@/features/sets/setsView'
import { rarityColor } from '@/lib/rarityColors'
import { createSerialQueue } from '@/lib/serialQueue'
import { metalRaidersChecklist, PRINTING } from './setFixtures'

const mk = (o: Partial<SetSummary>): SetSummary => ({
  language: 'en',
  setName: 'Set',
  setCode: 'SET',
  tcgDate: null,
  imageKey: null,
  packImageKey: null,
  logoImageKey: null,
  coverImageId: null,
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
  it('filters by language, with all keeping every set', () => {
    const ja = mk({ language: 'ja', setName: 'JP Set', ownedCards: 1 })
    const mixed = [started, ja]
    const o = { filter: 'all' as const, q: '', mode: 'cards' as const, types: [] }
    expect(filterSets(mixed, { ...o, language: 'ja' })).toEqual([ja])
    expect(filterSets(mixed, { ...o, language: 'all', types: [] })).toEqual(mixed)
  })
  it('started excludes untouched', () => {
    expect(
      filterSets(all, { filter: 'started', q: '', mode: 'cards', language: 'all', types: [] })
    ).toEqual([complete, started])
  })
  it('complete keeps only complete', () => {
    expect(
      filterSets(all, { filter: 'complete', q: '', mode: 'cards', language: 'all', types: [] })
    ).toEqual([complete])
  })
  it('matches code case-insensitively', () => {
    expect(
      filterSets(all, { filter: 'all', q: 'mrd', mode: 'cards', language: 'all', types: [] })
    ).toEqual([started])
  })
  it('matches name substring', () => {
    expect(
      filterSets(all, { filter: 'all', q: 'RAID', mode: 'cards', language: 'all', types: [] })
    ).toEqual([started])
  })
  it('matches a Japanese-named set by its English name or its own', () => {
    const gx = mk({ language: 'ja', setName: 'GXバトルブースト', setCode: 'SM4P' })
    const o = { filter: 'all' as const, mode: 'cards' as const, language: 'all' as const }
    expect(filterSets([started, gx], { ...o, q: 'battle boost', types: [] })).toEqual([gx])
    expect(filterSets([started, gx], { ...o, q: 'バトル', types: [] })).toEqual([gx])
  })
  it('filters by type, with none ticked keeping every type', () => {
    const booster = mk({ setName: 'Phantom Nightmare', setCode: 'PHNI' })
    const deck = mk({ setName: 'Structure Deck: Albaz Strike', setCode: 'SDAZ' })
    const o = { filter: 'all' as const, q: '', mode: 'cards' as const, language: 'all' as const }
    expect(filterSets([booster, deck], { ...o, types: ['deck'] })).toEqual([deck])
    expect(filterSets([booster, deck], { ...o, types: [] })).toEqual([booster, deck])
    expect(filterSets([booster, deck], { ...o, types: ['booster'], q: 'albaz' })).toEqual([])
  })
})

describe('typeCounts', () => {
  it('counts sets per type after progress, ignoring the type filter', () => {
    const booster = mk({ setName: 'Phantom Nightmare', setCode: 'PHNI', ownedCards: 1 })
    const deck = mk({ setName: 'Structure Deck: Albaz Strike', setCode: 'SDAZ' })
    const o = { mode: 'cards' as const, language: 'all' as const }
    expect(typeCounts([booster, deck], { ...o, filter: 'started' })).toEqual({
      booster: 1,
      deck: 0,
      tin: 0,
      collection: 0,
      promo: 0
    })
    expect(typeCounts([booster, deck], { ...o, filter: 'all' }).deck).toBe(1)
  })
})

describe('checklistSorts', () => {
  const labels = (game: 'ygo' | 'pkm'): string[] => checklistSorts(game).map((s) => s.label)

  it('offers ATK, DEF and Level on Yu-Gi-Oh!, and no HP', () => {
    expect(labels('ygo')).toEqual(
      expect.arrayContaining(['ATK: high to low', 'DEF: high to low', 'Level / Link: high to low'])
    )
    expect(labels('ygo').some((l) => l.startsWith('HP'))).toBe(false)
  })

  it('offers HP on Pokémon, and no ATK, DEF or Level', () => {
    expect(labels('pkm')).toContain('HP: high to low')
    expect(labels('pkm').some((l) => /^(ATK|DEF|Level)/.test(l))).toBe(false)
  })

  it('starts each sort in its usual direction', () => {
    expect(checklistSorts('pkm')[0]).toMatchObject({ value: 'number', dir: 'asc' })
    expect(checklistSorts('pkm').find((s) => s.value === 'price')?.dir).toBe('desc')
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
  it('name sorts a Japanese-named set by its English name', () => {
    const gx = mk({ setName: 'GXバトルブースト', setCode: 'SM4P' })
    const out = sortSets([untouched, gx, complete], 'name', 'cards')
    expect(out.map((s) => s.setCode)).toEqual(['SM4P', 'LOB', 'SRL'])
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
  price: null,
  atk: null,
  def: null,
  level: null,
  rarities: [
    { rarity: 'Common', owned: 0, codes: [], defaultPrintingId: 1, entryId: null, price: null },
    { rarity: 'Rare', owned: 2, codes: [], defaultPrintingId: 2, entryId: 7, price: null }
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

describe('sortTiles', () => {
  it('sorts by HP, with cards that have none last', () => {
    const tile = (cardId: number, hp?: number): Tile =>
      ({ key: String(cardId), card: { cardId, hp } as ChecklistCard, rarity: null }) as Tile
    const ids = (t: Tile[]): number[] => t.map((x) => x.card.cardId)
    expect(ids(sortTiles([tile(1, 60), tile(2), tile(3, 120)], 'hp', 'desc'))).toEqual([3, 1, 2])
  })

  const names = (tiles: { card: ChecklistCard }[]): string[] => tiles.map((t) => t.card.name)
  const cardTiles = checklistTiles(metalRaidersChecklist, 'cards')

  it('sorts by ATK with cards that have none last, whichever the direction', () => {
    expect(names(sortTiles(cardTiles, 'atk', 'desc'))).toEqual([
      'Alpha Dragon',
      'Beta Knight',
      'Gamma Trap'
    ])
    expect(names(sortTiles(cardTiles, 'atk', 'asc'))).toEqual([
      'Beta Knight',
      'Alpha Dragon',
      'Gamma Trap'
    ])
  })

  it('sorts by name and set number', () => {
    expect(names(sortTiles(cardTiles, 'name', 'desc'))).toEqual([
      'Gamma Trap',
      'Beta Knight',
      'Alpha Dragon'
    ])
    expect(names(sortTiles(cardTiles, 'number', 'desc'))).toEqual([
      'Gamma Trap',
      'Beta Knight',
      'Alpha Dragon'
    ])
  })

  it('prices each rarity tile by its own rarity', () => {
    const tiles = sortTiles(checklistTiles(metalRaidersChecklist, 'rarities'), 'price', 'desc')
    expect(tiles.map((t) => t.rarity)).toEqual(['Secret Rare', 'Ultra Rare', 'Rare', 'Common'])
  })

  it('sortCards orders bulk cards the same way', () => {
    expect(sortCards(metalRaidersChecklist.cards, 'price', 'asc').map((c) => c.name)).toEqual([
      'Gamma Trap',
      'Alpha Dragon',
      'Beta Knight'
    ])
  })
})

describe('adjustChecklistCard', () => {
  const alpha = metalRaidersChecklist.cards[0]

  it('moves the code, its rarity and the card by one', () => {
    const up = adjustChecklistCard(alpha, PRINTING.alphaSecret, 1)
    expect(up.owned).toBe(3)
    expect(up.rarities[0]).toMatchObject({ owned: 1, codes: [{ owned: 1 }] })
    expect(up.rarities[1]).toBe(alpha.rarities[1])
    const down = adjustChecklistCard(alpha, PRINTING.alphaUltraE001, -1)
    expect(down.owned).toBe(1)
    expect(down.rarities[1].owned).toBe(1)
    expect(down.rarities[1].codes.map((c) => c.owned)).toEqual([0, 1, 0])
  })

  it('never goes below zero, like the server', () => {
    expect(adjustChecklistCard(alpha, PRINTING.alphaSecret, -1)).toBe(alpha)
  })
})

describe('patchSetSummary', () => {
  it("replaces only the matching set's owned counts", () => {
    const en = mk({ setName: 'Metal Raiders', totalCards: 3 })
    const ja = mk({ setName: 'Metal Raiders', language: 'ja' })
    const other = mk({ setName: 'Other' })
    const fresh = { ...en, ownedCards: 2, ownedRarities: 3, totalCards: 99 }
    expect(patchSetSummary([en, ja, other], fresh)).toEqual([
      { ...en, ownedCards: 2, ownedRarities: 3 },
      ja,
      other
    ])
  })
})

describe('bulkTiles', () => {
  it('makes one tile per card and rarity, in order', () => {
    const tiles = bulkTiles(metalRaidersChecklist.cards)
    expect(tiles.map((t) => t.key)).toEqual(
      metalRaidersChecklist.cards.flatMap((c) => c.rarities.map((r) => `${c.cardId}:${r.rarity}`))
    )
    expect(tiles[0].key).toBe('1001:Secret Rare')
    expect(tiles[1].key).toBe('1001:Ultra Rare')
    expect(tiles[2].key).toBe('2001:Common')
  })
})

describe('filterBulkCards', () => {
  const cards = metalRaidersChecklist.cards
  const names = (q: string): string[] => filterBulkCards(cards, q).map((c) => c.name)

  it('returns everything for an empty query', () => {
    expect(filterBulkCards(cards, '')).toEqual(cards)
  })

  it('treats a bare number as an exact set number', () => {
    expect(names('2')).toEqual(['Beta Knight'])
    expect(names(' 1 ')).toEqual(['Alpha Dragon'])
    expect(names('10')).toEqual(['Gamma Trap'])
  })

  it('falls back to the text search otherwise', () => {
    expect(names('999')).toEqual([])
    expect(names('beta')).toEqual(['Beta Knight'])
    expect(names('MRD-E001')).toEqual(['Alpha Dragon'])
  })
})

describe('rarityColor', () => {
  it('maps known rarities and falls back to grey', () => {
    expect(rarityColor('Secret Rare')).toBe('#c8b6ff')
    expect(rarityColor('Mystery')).toBe('#9ca3af')
  })
})

describe('upcoming sets', () => {
  const base = {
    language: 'en',
    setName: 'S',
    setCode: 'S',
    imageKey: null,
    packImageKey: null,
    logoImageKey: null,
    coverImageId: null,
    totalCards: 1,
    ownedCards: 0,
    totalRarities: 1,
    ownedRarities: 0,
    listRows: null,
    unmatchedRows: null
  } as const

  it('cutoff is 30 local days after today, across month and year ends', () => {
    expect(upcomingCutoff(new Date(2026, 9, 29, 23, 59))).toBe('2026-11-28')
    expect(upcomingCutoff(new Date(2026, 11, 15, 0, 1))).toBe('2027-01-14')
  })

  it('only unstarted sets dated after the cutoff are upcoming', () => {
    const cut = '2026-11-28'
    expect(isUpcoming({ ...base, tcgDate: '2026-11-28' }, cut)).toBe(false)
    expect(isUpcoming({ ...base, tcgDate: '2026-11-29' }, cut)).toBe(true)
    expect(isUpcoming({ ...base, tcgDate: null }, cut)).toBe(false)
    expect(isUpcoming({ ...base, tcgDate: '2027-01-01', ownedCards: 1 }, cut)).toBe(false)
    expect(isUpcoming({ ...base, tcgDate: '2027-01-01', ownedRarities: 1 }, cut)).toBe(false)
  })

  it('splitUpcoming keeps each side in the given order', () => {
    const a = { ...base, setName: 'A', tcgDate: '2027-02-01' }
    const b = { ...base, setName: 'B', tcgDate: '2020-01-01' }
    const c = { ...base, setName: 'C', tcgDate: '2027-01-01' }
    const d = { ...base, setName: 'D', tcgDate: null }
    const e = { ...base, setName: 'E', tcgDate: '2027-03-01', ownedRarities: 2 }
    const { current, upcoming } = splitUpcoming([a, b, c, d, e], '2026-11-28')
    expect(current.map((s) => s.setName)).toEqual(['B', 'D', 'E'])
    expect(upcoming.map((s) => s.setName)).toEqual(['A', 'C'])
    expect(splitUpcoming([], '2026-11-28')).toEqual({ current: [], upcoming: [] })
  })
})

describe('rarityCounts', () => {
  it('counts cards per rarity, lowest rarity first, unknown ones last by name', () => {
    const named = (cards: ChecklistCard[]): SetChecklist => ({ set: started, cards })
    const card = (cardId: number, rarities: string[]): ChecklistCard => ({
      ...alpha,
      cardId,
      rarities: rarities.map((rarity) => ({ ...alpha.rarities[0], rarity }))
    })
    const cl = named([
      card(1, ['Secret Rare', 'Common']),
      card(2, ['Common']),
      card(3, ['Reverse Holofoil', 'Holofoil'])
    ])
    expect(rarityCounts(cl)).toEqual([
      { rarity: 'Common', count: 2 },
      { rarity: 'Secret Rare', count: 1 },
      { rarity: 'Holofoil', count: 1 },
      { rarity: 'Reverse Holofoil', count: 1 }
    ])
  })
})

describe('Pokémon rarity chips', () => {
  const finishes = (names: string[]): ChecklistCard['rarities'] =>
    names.map((rarity) => ({ ...alpha.rarities[0], rarity }))
  const card = (cardId: number, cardRarity: string | null): ChecklistCard => ({
    ...alpha,
    cardId,
    cardRarity,
    rarities: finishes(['Normal', 'Reverse Holofoil'])
  })
  const cl: SetChecklist = {
    set: started,
    cards: [
      card(1, 'Common'),
      card(2, 'Illustration rare'),
      card(3, 'Illustration Rare'),
      card(4, null),
      card(5, 'ACE SPEC Rare'),
      card(6, 'Rare')
    ]
  }

  it('counts each card once under its own rarity, in order, with Unknown last', () => {
    expect(rarityCounts(cl)).toEqual([
      { rarity: 'Common', count: 1 },
      { rarity: 'Rare', count: 1 },
      { rarity: 'Illustration rare', count: 2 },
      { rarity: 'ACE SPEC Rare', count: 1 },
      { rarity: 'Unknown', count: 1 }
    ])
  })

  it('keeps every finish tile of the matching cards', () => {
    const out = filterTilesByRarity(checklistTiles(cl, 'rarities'), ['Illustration Rare'])
    expect(out.map((t) => t.key)).toEqual([
      '2|Normal',
      '2|Reverse Holofoil',
      '3|Normal',
      '3|Reverse Holofoil'
    ])
  })
})

describe('filterTilesByRarity', () => {
  const rarity = alpha.rarities[0].rarity
  it('keeps every tile with no rarity chosen', () => {
    const tiles = checklistTiles(checklist, 'rarities')
    expect(filterTilesByRarity(tiles, [])).toEqual(tiles)
  })
  it('keeps the tiles of that rarity in every-rarity mode', () => {
    const out = filterTilesByRarity(checklistTiles(checklist, 'rarities'), [rarity])
    expect(out.every((t) => t.rarity === rarity)).toBe(true)
    expect(out).toHaveLength(1)
  })
  it('keeps a card with that rarity in each-card-once mode', () => {
    expect(filterTilesByRarity(checklistTiles(checklist, 'cards'), [rarity])).toHaveLength(1)
    expect(filterTilesByRarity(checklistTiles(checklist, 'cards'), ['Nope'])).toHaveLength(0)
  })
  it('keeps the tiles of any picked rarity', () => {
    const tiles = checklistTiles(checklist, 'rarities')
    const picked = [...new Set(tiles.map((t) => t.rarity as string))]
    expect(picked.length).toBeGreaterThan(1)
    expect(filterTilesByRarity(tiles, picked)).toEqual(tiles)
    expect(filterTilesByRarity(tiles, [picked[0], 'Nope'])).toEqual(
      filterTilesByRarity(tiles, [picked[0]])
    )
  })
})
