import {
  buildSlots,
  type Slot,
  type SlotCopy,
  type SlotEdit,
  type SlotImage,
  type SlotPrinting
} from '../../src/main/repo/binderSlots'

let nextId = 1
const pr = (pkey: string, cardId: number, over: Partial<SlotPrinting> = {}): SlotPrinting => ({
  pkey,
  printingId: nextId++,
  cardId,
  listed: true,
  qualifies: true,
  price: null,
  ...over
})
const img = (imageId: number, cardId: number, sortOrder = 0): SlotImage => ({
  imageId,
  cardId,
  sortOrder
})
const copy = (pkey: string, cardId: number, imageId = 0, quantity = 1): SlotCopy => ({
  pkey,
  cardId,
  imageId,
  quantity
})
const add = (level: SlotEdit['level'], target: string | number): SlotEdit => ({
  level,
  target: String(target),
  action: 'add'
})
const remove = (level: SlotEdit['level'], target: string | number): SlotEdit => ({
  level,
  target: String(target),
  action: 'remove'
})
const keys = (slots: Slot[]): string[] => slots.map((s) => s.key)
const owned = (slots: Slot[]): string[] => slots.filter((s) => s.owned > 0).map((s) => s.key)

describe('art goal', () => {
  const printings = [pr('a', 1)]
  const images = [img(12, 1, 1), img(11, 1, 0), img(13, 1, 2)]

  it('makes one slot per image, and a copy fills only its own art', () => {
    const r = buildSlots('art', printings, images, [copy('a', 1, 12, 2)], [])
    expect(keys(r.slots)).toEqual(['art:11', 'art:12', 'art:13'])
    expect(owned(r.slots)).toEqual(['art:12'])
    expect(r.slots[1]).toMatchObject({
      level: 'art',
      cardId: 1,
      imageId: 12,
      owned: 2,
      added: false
    })
    expect(r).toMatchObject({ ownedSlots: 1, missingSlots: 2 })
  })

  it('does not fill an art from a copy on a non-qualifying printing', () => {
    const ps = [pr('a', 1), pr('b', 1, { qualifies: false })]
    expect(buildSlots('art', ps, images, [copy('b', 1, 11)], []).ownedSlots).toBe(0)
  })

  it('makes no slots for a card whose only qualifying printing is unlisted', () => {
    const ps = [pr('a', 1, { listed: false })]
    expect(buildSlots('art', ps, images, [], []).slots).toEqual([])
  })

  it('an added printing makes the art slot of its copy, filled by any copy of that art', () => {
    const ps = [pr('x', 2, { qualifies: false }), pr('y', 2, { qualifies: false })]
    const r = buildSlots(
      'art',
      ps,
      [img(21, 2), img(22, 2)],
      [copy('x', 2, 22)],
      [add('printing', 'x')]
    )
    expect(keys(r.slots)).toEqual(['art:22'])
    expect(r.slots[0]).toMatchObject({ level: 'art', imageId: 22, added: true, owned: 1 })
    expect(
      buildSlots('art', ps, [img(22, 2)], [copy('y', 2, 22)], [add('printing', 'x')]).slots
    ).toMatchObject([{ key: 'card:2', level: 'card', imageId: null, added: true, owned: 1 }])
  })

  it('an added printing with no copy makes a card slot', () => {
    const ps = [pr('x', 2, { qualifies: false })]
    const r = buildSlots('art', ps, [img(21, 2), img(22, 2)], [], [add('printing', 'x')])
    expect(r.slots).toMatchObject([
      { key: 'card:2', level: 'card', imageId: null, added: true, owned: 0 }
    ])
    expect(r.slots[0].printing?.pkey).toBe('x')
  })

  it('an added printing on a matched card gains no extra slot', () => {
    const r = buildSlots('art', printings, images, [], [add('printing', 'a')])
    expect(keys(r.slots)).toEqual(['art:11', 'art:12', 'art:13'])
    expect(r.slots.every((s) => s.added)).toBe(true)
  })

  it('a copy-less added printing on a matched card lets any copy of an art fill it', () => {
    const ps = [pr('a', 1), pr('n', 1, { qualifies: false }), pr('o', 1, { qualifies: false })]
    const r = buildSlots('art', ps, images, [copy('o', 1, 11)], [add('printing', 'n')])
    expect(keys(r.slots)).toEqual(['art:11', 'art:12', 'art:13'])
    expect(r.slots[0]).toMatchObject({ added: true, owned: 1 })
    expect(r).toMatchObject({ ownedSlots: 1, missingSlots: 2 })
  })

  it('added printings give the same slots in either order, with one copy filling one slot', () => {
    const p = pr('p', 2, { qualifies: false })
    const q = pr('q', 2, { qualifies: false })
    const edits = [add('printing', 'p'), add('printing', 'q')]
    for (const ps of [
      [p, q],
      [q, p]
    ]) {
      const r = buildSlots('art', ps, [img(21, 2), img(22, 2)], [copy('q', 2, 22)], edits)
      expect(keys(r.slots)).toEqual(['art:22'])
      expect(r).toMatchObject({ ownedSlots: 1, missingSlots: 0 })
    }
  })

  it('an art removal beats an added printing whose copy has that art', () => {
    const ps = [pr('x', 2, { qualifies: false })]
    const r = buildSlots(
      'art',
      ps,
      [img(21, 2)],
      [copy('x', 2, 21)],
      [add('printing', 'x'), remove('art', 21)]
    )
    expect(r.slots).toEqual([])
  })
})

describe('card goal', () => {
  it('a copy on a non-qualifying Common leaves the slot missing', () => {
    const ps = [pr('secret', 1), pr('common', 1, { listed: true, qualifies: false })]
    const r = buildSlots('card', ps, [img(11, 1)], [copy('common', 1, 11)], [])
    expect(r.slots).toMatchObject([
      { key: 'card:1', level: 'card', imageId: null, owned: 0, added: false }
    ])
    expect(r).toMatchObject({ ownedSlots: 0, missingSlots: 1 })
  })

  it('a copy on a printing outside the matched set does not fill a rule slot', () => {
    expect(buildSlots('card', [pr('a', 1)], [], [copy('elsewhere', 1, 11)], []).ownedSlots).toBe(0)
  })

  it('makes one slot per card however many printings match, summing owned copies', () => {
    const r = buildSlots(
      'card',
      [pr('a', 1), pr('b', 1)],
      [],
      [copy('a', 1, 0, 2), copy('b', 1, 0, 3)],
      []
    )
    expect(r.slots).toMatchObject([{ key: 'card:1', owned: 5 }])
  })

  it('a card with no listed qualifying printing makes no slot', () => {
    const ps = [pr('a', 1, { qualifies: false }), pr('b', 1, { listed: false })]
    expect(buildSlots('card', ps, [], [], []).slots).toEqual([])
  })
})

describe('contributed and hidden printings', () => {
  const ps = [pr('main', 1), pr('contrib', 1, { listed: false })]

  it('a copy on a contributed qualifying printing fills a card slot', () => {
    expect(buildSlots('card', ps, [], [copy('contrib', 1)], []).ownedSlots).toBe(1)
  })

  it('a copy on a contributed qualifying printing fills an art slot', () => {
    expect(buildSlots('art', ps, [img(11, 1)], [copy('contrib', 1, 11)], []).ownedSlots).toBe(1)
  })

  it('makes no printing slot unless added', () => {
    expect(keys(buildSlots('printing', ps, [], [copy('contrib', 1)], []).slots)).toEqual([
      'printing:main'
    ])
    const r = buildSlots('printing', ps, [], [copy('contrib', 1)], [add('printing', 'contrib')])
    expect(keys(r.slots)).toEqual(['printing:main', 'printing:contrib'])
    expect(r.slots[1]).toMatchObject({ added: true, owned: 1 })
  })
})

describe('added card', () => {
  // Card 2 is not matched by any rule. Its printing in another language still comes through as added.
  const ps = [
    pr('en', 2, { qualifies: false }),
    pr('ja', 2, { qualifies: false }),
    pr('hidden', 2, { qualifies: false, listed: false })
  ]
  const images = [img(21, 2, 0), img(22, 2, 1), img(23, 2, 2)]
  const edits = [add('card', 2)]

  it('gives 1 slot under card', () => {
    expect(buildSlots('card', ps, images, [], edits).slots).toMatchObject([
      { key: 'card:2', added: true }
    ])
  })

  it('gives one slot per art under art', () => {
    const r = buildSlots('art', ps, images, [], edits)
    expect(keys(r.slots)).toEqual(['art:21', 'art:22', 'art:23'])
    expect(r.slots.every((s) => s.added)).toBe(true)
  })

  it('gives one slot per listed printing in any language under printing', () => {
    const r = buildSlots('printing', ps, images, [], edits)
    expect(keys(r.slots)).toEqual(['printing:en', 'printing:ja'])
    expect(r.slots.every((s) => s.added && s.level === 'printing')).toBe(true)
  })

  it('any copy of it fills a card slot', () => {
    expect(buildSlots('card', ps, images, [copy('hidden', 2)], edits).ownedSlots).toBe(1)
    expect(buildSlots('card', ps, images, [copy('not-sent', 2)], edits).ownedSlots).toBe(1)
  })

  it('still needs the matching image for an art slot', () => {
    const r = buildSlots('art', ps, images, [copy('ja', 2, 22)], edits)
    expect(owned(r.slots)).toEqual(['art:22'])
  })

  it('still needs that printing for a printing slot', () => {
    const r = buildSlots('printing', ps, images, [copy('ja', 2)], edits)
    expect(owned(r.slots)).toEqual(['printing:ja'])
  })

  it('stays when it has no printings or images to expand to', () => {
    for (const goal of ['card', 'art', 'printing'] as const) {
      expect(buildSlots(goal, [], [], [], [add('card', 9)]).slots).toMatchObject([
        { key: 'card:9', cardId: 9, level: 'card', imageId: null, printing: null, added: true }
      ])
    }
  })

  it('ignores a target that is not a card id', () => {
    expect(buildSlots('card', [], [], [], [add('card', 'junk')]).slots).toEqual([])
  })

  it('that the rule matches gains no extra slots, and any copy fills it', () => {
    const matched = [pr('rule', 1), pr('other', 1, { qualifies: false })]
    const imgs = [img(11, 1)]
    const edit = [add('card', 1)]
    const card = buildSlots('card', matched, imgs, [copy('other', 1, 11)], edit)
    expect(card.slots).toMatchObject([{ key: 'card:1', added: true, owned: 1 }])
    const art = buildSlots('art', matched, imgs, [copy('other', 1, 11)], edit)
    expect(art.slots).toMatchObject([{ key: 'art:11', added: true, owned: 1 }])
    const printing = buildSlots('printing', matched, imgs, [copy('other', 1, 11)], edit)
    expect(printing.slots).toMatchObject([{ key: 'printing:rule', added: true, owned: 0 }])
  })
})

describe('added printing', () => {
  const ps = [pr('p', 3, { qualifies: false }), pr('q', 3, { qualifies: false })]
  const edits = [add('printing', 'p')]

  it('adds its card under card, and any copy of the card fills it', () => {
    const r = buildSlots('card', ps, [], [copy('q', 3)], edits)
    expect(r.slots).toMatchObject([{ key: 'card:3', level: 'card', added: true, owned: 1 }])
  })

  it('makes one slot under printing, even if unlisted, filled only by that printing', () => {
    const unlisted = [pr('p', 3, { qualifies: false, listed: false })]
    expect(keys(buildSlots('printing', unlisted, [], [], edits).slots)).toEqual(['printing:p'])
    expect(buildSlots('printing', ps, [], [copy('q', 3)], edits).slots).toMatchObject([
      { key: 'printing:p', added: true, owned: 0 }
    ])
  })

  it('does not double up with the same printing from a rule or an added card', () => {
    const r = buildSlots('printing', [pr('m', 4)], [], [], [add('printing', 'm'), add('card', 4)])
    expect(r.slots).toMatchObject([{ key: 'printing:m', added: true }])
  })

  it('that has not reached the catalog is ignored until it does', () => {
    const r = buildSlots('printing', [], [], [copy('absent', 3)], [add('printing', 'absent')])
    expect(r.slots).toEqual([])
  })
})

describe('removals', () => {
  const ps = [pr('a', 1), pr('b', 1), pr('c', 2)]
  const images = [img(11, 1, 0), img(12, 1, 1), img(21, 2)]

  it('removing an art leaves the card’s other art slots', () => {
    expect(keys(buildSlots('art', ps, images, [], [remove('art', 11)]).slots)).toEqual([
      'art:12',
      'art:21'
    ])
  })

  it('removing an art leaves other goals alone', () => {
    expect(keys(buildSlots('card', ps, images, [], [remove('art', 11)]).slots)).toEqual([
      'card:1',
      'card:2'
    ])
  })

  it('removing a card drops all its slots under every goal', () => {
    const edits = [remove('card', 1)]
    expect(keys(buildSlots('art', ps, images, [], edits).slots)).toEqual(['art:21'])
    expect(keys(buildSlots('card', ps, images, [], edits).slots)).toEqual(['card:2'])
    expect(keys(buildSlots('printing', ps, images, [], edits).slots)).toEqual(['printing:c'])
    expect(buildSlots('none', ps, images, [copy('a', 1, 11)], edits).slots).toEqual([])
  })

  it('a removal beats an add at the same level', () => {
    expect(
      buildSlots('card', ps, images, [], [add('card', 7), remove('card', 7)]).slots
    ).toHaveLength(2)
    const r = buildSlots(
      'printing',
      ps,
      images,
      [],
      [add('printing', 'a'), remove('printing', 'a')]
    )
    expect(keys(r.slots)).toEqual(['printing:b', 'printing:c'])
  })

  it('a removal beats an add at a broader level, in either edit order', () => {
    for (const edits of [
      [remove('card', 1), add('printing', 'a')],
      [add('printing', 'a'), remove('card', 1)]
    ]) {
      expect(keys(buildSlots('printing', ps, images, [], edits).slots)).toEqual(['printing:c'])
    }
  })

  it('removing a printing keeps an added card’s other printings', () => {
    const r = buildSlots('printing', ps, images, [], [add('card', 1), remove('printing', 'a')])
    expect(keys(r.slots)).toEqual(['printing:b', 'printing:c'])
  })

  it('a removed printing no longer makes, fills or prices a card slot', () => {
    const pricedA = pr('a', 1, { price: 1 })
    const pricedB = pr('b', 1, { price: 5 })
    const r = buildSlots('card', [pricedA, pricedB], [], [copy('a', 1)], [remove('printing', 'a')])
    expect(r.slots).toMatchObject([{ key: 'card:1', owned: 0, price: 5 }])
    expect(buildSlots('card', [pricedA], [], [], [remove('printing', 'a')]).slots).toEqual([])
    expect(
      buildSlots(
        'card',
        [pr('a', 1)],
        [],
        [copy('a', 1)],
        [add('card', 1), remove('printing', 'a')]
      ).ownedSlots
    ).toBe(0)
  })

  it('a card matched only through a removed printing is expanded when added', () => {
    const only = [pr('r', 5), pr('u', 5, { qualifies: false })]
    const r = buildSlots('printing', only, [], [], [add('card', 5), remove('printing', 'r')])
    expect(keys(r.slots)).toEqual(['printing:u'])
  })

  it('an added card whose only printing was removed makes no printing slot', () => {
    const r = buildSlots(
      'printing',
      [pr('u', 5)],
      [],
      [],
      [add('card', 5), remove('printing', 'u')]
    )
    expect(r).toMatchObject({ slots: [], missingSlots: 0 })
  })
})

describe('goal changes', () => {
  it('gives identical slots after switching art to card and back', () => {
    const ps = [pr('a', 1), pr('x', 2, { qualifies: false })]
    const images = [img(11, 1, 0), img(12, 1, 1), img(21, 2)]
    const edits = [remove('art', 11), add('card', 2)]
    const before = buildSlots('art', ps, images, [], edits)
    buildSlots('card', ps, images, [], edits)
    expect(buildSlots('art', ps, images, [], edits)).toEqual(before)
    expect(keys(before.slots)).toEqual(['art:12', 'art:21'])
  })
})

describe('no goal', () => {
  it('shows owned matches plus every added card or printing, with nothing missing', () => {
    const ps = [
      pr('owned', 1, { price: 2 }),
      pr('unowned', 2, { price: 2 }),
      pr('common', 3, { qualifies: false }),
      pr('contrib', 6, { listed: false }),
      pr('added-card', 4, { qualifies: false, price: 9 }),
      pr('added-printing', 5, { qualifies: false })
    ]
    const copies = [copy('owned', 1), copy('common', 3), copy('contrib', 6)]
    const r = buildSlots('none', ps, [], copies, [
      add('card', 4),
      add('printing', 'added-printing')
    ])
    expect(keys(r.slots).sort()).toEqual(['card:1', 'card:4', 'card:5', 'card:6'])
    expect(r).toMatchObject({
      ownedSlots: 2,
      missingSlots: 0,
      valueToFinish: 0,
      unpricedMissing: 0
    })
    expect(r.slots.every((s) => s.price === null)).toBe(true)
  })
})

describe('value to finish', () => {
  it('sums missing slots and counts the unpriced', () => {
    const ps = [pr('a', 1, { price: 1.5 }), pr('b', 2, { price: 3 }), pr('c', 3)]
    const r = buildSlots('card', ps, [], [], [])
    expect(r.valueToFinish).toBe(4.5)
    expect(r.unpricedMissing).toBe(1)
    expect(r.slots.map((s) => s.price)).toEqual([1.5, 3, null])
  })

  it('takes a slot’s cheapest positive price', () => {
    const ps = [
      pr('a', 1, { price: 4 }),
      pr('b', 1, { price: 2 }),
      pr('c', 1, { price: 0 }),
      pr('d', 1)
    ]
    const r = buildSlots('card', ps, [], [], [])
    expect(r.valueToFinish).toBe(2)
    expect(r.slots[0].price).toBe(2)
  })

  it('treats a slot with only zero prices as unpriced', () => {
    const r = buildSlots('card', [pr('a', 1, { price: 0 })], [], [], [])
    expect(r).toMatchObject({ valueToFinish: 0, unpricedMissing: 1 })
  })

  it('only prices a rule slot from printings that could fill it', () => {
    const ps = [
      pr('a', 1, { price: 8 }),
      pr('common', 1, { qualifies: false, price: 1 }),
      pr('contrib', 1, { listed: false, price: 6 })
    ]
    expect(buildSlots('card', ps, [], [], []).valueToFinish).toBe(6)
  })

  it('prices an added card from any of its printings', () => {
    const ps = [pr('a', 1, { price: 8 }), pr('common', 1, { qualifies: false, price: 1 })]
    expect(buildSlots('card', ps, [], [], [add('card', 1)]).valueToFinish).toBe(1)
  })

  it('prices a printing slot from that printing only, once per slot', () => {
    const ps = [pr('a', 1, { price: 8 }), pr('b', 1, { price: 1 })]
    expect(buildSlots('printing', ps, [], [], []).valueToFinish).toBe(9)
  })

  it('prices each missing art slot, and owned slots add nothing', () => {
    const r = buildSlots(
      'art',
      [pr('a', 1, { price: 2 })],
      [img(11, 1), img(12, 1, 1)],
      [copy('a', 1, 11)],
      []
    )
    expect(r).toMatchObject({ valueToFinish: 2, unpricedMissing: 0, missingSlots: 1 })
    expect(r.slots.map((s) => s.price)).toEqual([null, 2])
  })

  it('ignores owned unpriced slots', () => {
    expect(buildSlots('card', [pr('a', 1)], [], [copy('a', 1)], []).unpricedMissing).toBe(0)
  })
})

describe('no matches', () => {
  it.each(['none', 'card', 'art', 'printing'] as const)('%s is empty with zero counts', (goal) => {
    expect(buildSlots(goal, [], [], [], [])).toEqual({
      slots: [],
      ownedSlots: 0,
      missingSlots: 0,
      valueToFinish: 0,
      unpricedMissing: 0
    })
  })
})
