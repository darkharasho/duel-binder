import type { BinderEditAction, BinderEditLevel, BinderGoal } from '../../shared/binders'

export interface SlotPrinting {
  pkey: string
  printingId: number
  cardId: number
  listed: boolean // false for contributed or hidden printings
  qualifies: boolean // passes the binder's rules and languages
  price: number | null
}
export interface SlotImage {
  imageId: number
  cardId: number
  sortOrder: number
}
export interface SlotCopy {
  pkey: string
  cardId: number
  imageId: number
  quantity: number
}
export interface SlotEdit {
  level: BinderEditLevel
  target: string
  action: BinderEditAction
}
export interface Slot {
  key: string // `${level}:${target}`, so a removal can target the slot
  level: BinderEditLevel
  cardId: number
  imageId: number | null
  printing: SlotPrinting | null
  owned: number
  added: boolean
  price: number | null
}
export interface SlotResult {
  slots: Slot[]
  ownedSlots: number
  missingSlots: number
  valueToFinish: number
  unpricedMissing: number
}

const push = <K, V>(map: Map<K, V[]>, key: K, value: V): void => {
  const list = map.get(key)
  if (list) list.push(value)
  else map.set(key, [value])
}
const plus = <K>(map: Map<K, number>, key: K, n: number): void => {
  map.set(key, (map.get(key) ?? 0) + n)
}
const lowest = <K>(map: Map<K, number>, key: K, price: number): void => {
  const known = map.get(key)
  if (known === undefined || price < known) map.set(key, price)
}
const usablePrice = (p: SlotPrinting): number | null =>
  p.price !== null && p.price > 0 ? p.price : null

/** Who may fill a slot: `any` for an added slot, `rule` (qualifying printings only) otherwise. */
interface Tally<K> {
  any: Map<K, number>
  rule: Map<K, number>
}
const tally = <K>(): Tally<K> => ({ any: new Map(), rule: new Map() })

/**
 * Turn a binder's printings, images, owned copies and hand edits into completion slots.
 *
 * `printings` holds rule matches plus the printings of added cards and printings. Hand edits are
 * re-applied on every call, so switching goals and back gives the same binder. An added slot fills
 * from any copy of its own target: the card for a card slot, the art for an art slot, the printing
 * for a printing slot.
 */
export function buildSlots(
  goal: BinderGoal,
  printings: SlotPrinting[],
  images: SlotImage[],
  copies: SlotCopy[],
  edits: SlotEdit[]
): SlotResult {
  const targets = (level: BinderEditLevel, action: BinderEditAction): string[] =>
    edits.filter((e) => e.level === level && e.action === action).map((e) => e.target)
  const removedCards = new Set(targets('card', 'remove').map(Number))
  const removedArts = new Set(targets('art', 'remove').map(Number))
  const removedPrintings = new Set(targets('printing', 'remove'))
  const addedCards = new Set(
    targets('card', 'add')
      .map(Number)
      .filter((id) => Number.isInteger(id) && !removedCards.has(id))
  )
  const addedPrintingKeys = new Set(targets('printing', 'add'))

  // Removals first: from here on a removed card or printing does not exist.
  const live = printings.filter((p) => !removedPrintings.has(p.pkey) && !removedCards.has(p.cardId))
  const byKey = new Map(live.map((p) => [p.pkey, p]))
  const addedPrintings = live.filter((p) => addedPrintingKeys.has(p.pkey))
  const listedByCard = new Map<number, SlotPrinting[]>()
  const ruleCards = new Set<number>()
  for (const p of live) {
    if (!p.listed) continue
    push(listedByCard, p.cardId, p)
    if (p.qualifies) ruleCards.add(p.cardId)
  }

  const plans = new Map<string, Omit<Slot, 'owned' | 'price'>>()
  const cardsWithSlots = new Set<number>()
  const put = (
    level: BinderEditLevel,
    target: string | number,
    cardId: number,
    imageId: number | null,
    printing: SlotPrinting | null,
    added: boolean
  ): void => {
    const key = `${level}:${target}`
    const plan = plans.get(key)
    if (plan) {
      plan.added ||= added
      plan.printing ??= printing
      return
    }
    plans.set(key, { key, level, cardId, imageId, printing, added })
    cardsWithSlots.add(cardId)
  }
  const putCard = (cardId: number, printing: SlotPrinting | null, added: boolean): void =>
    put('card', cardId, cardId, null, printing, added)
  const putPrinting = (p: SlotPrinting, added: boolean): void =>
    put('printing', p.pkey, p.cardId, null, p, added)
  const putArt = (imageId: number, cardId: number, added: boolean): void =>
    put('art', imageId, cardId, imageId, null, added)

  const addCardsWhole = (): void => {
    for (const cardId of addedCards) putCard(cardId, null, true)
    for (const p of addedPrintings) putCard(p.cardId, p, true)
  }

  if (goal === 'card') {
    for (const cardId of ruleCards) putCard(cardId, null, false)
    addCardsWhole()
  } else if (goal === 'none') {
    for (const c of copies) {
      const p = byKey.get(c.pkey)
      if (p?.qualifies) putCard(p.cardId, null, false)
    }
    addCardsWhole()
  } else if (goal === 'art') {
    const imagesByCard = new Map<number, SlotImage[]>()
    for (const image of [...images].sort((a, b) => a.sortOrder - b.sortOrder))
      push(imagesByCard, image.cardId, image)
    for (const cardId of new Set([...ruleCards, ...addedCards])) {
      for (const image of imagesByCard.get(cardId) ?? []) {
        if (!removedArts.has(image.imageId)) putArt(image.imageId, cardId, addedCards.has(cardId))
      }
    }
    const artsByPrinting = new Map<string, Set<number>>()
    for (const c of copies) {
      if (!addedPrintingKeys.has(c.pkey)) continue
      if (artsByPrinting.has(c.pkey)) artsByPrinting.get(c.pkey)?.add(c.imageId)
      else artsByPrinting.set(c.pkey, new Set([c.imageId]))
    }
    for (const p of addedPrintings) {
      for (const imageId of artsByPrinting.get(p.pkey) ?? [])
        if (!removedArts.has(imageId)) putArt(imageId, p.cardId, true)
    }
    // After every art slot exists, so the result can't depend on the order of `printings`. A
    // printing with no copy has no known art, so it adds its card: its art slots, or else a card slot.
    for (const p of addedPrintings) {
      if (artsByPrinting.has(p.pkey)) continue
      if (!cardsWithSlots.has(p.cardId)) putCard(p.cardId, p, true)
      for (const image of imagesByCard.get(p.cardId) ?? []) {
        const plan = plans.get(`art:${image.imageId}`)
        if (plan) plan.added = true
      }
    }
    for (const cardId of addedCards) if (!imagesByCard.has(cardId)) putCard(cardId, null, true)
  } else {
    for (const cardId of ruleCards) {
      for (const p of listedByCard.get(cardId) ?? [])
        if (p.qualifies) putPrinting(p, addedCards.has(cardId))
    }
    for (const cardId of addedCards) {
      if (ruleCards.has(cardId)) continue
      for (const p of listedByCard.get(cardId) ?? []) putPrinting(p, true)
    }
    for (const p of addedPrintings) putPrinting(p, true)
    // A hand-added card stays until removed, even with no printing to expand to. One whose
    // printings the user removed has had its slots removed, not lost.
    const cardsLosingPrintings = new Set(
      printings.filter((p) => removedPrintings.has(p.pkey)).map((p) => p.cardId)
    )
    for (const cardId of addedCards) {
      if (!cardsWithSlots.has(cardId) && !cardsLosingPrintings.has(cardId)) {
        putCard(cardId, null, true)
      }
    }
  }

  const ownedByCard = tally<number>()
  const ownedByArt = tally<number>()
  const ownedByPrinting = new Map<string, number>()
  for (const c of copies) {
    if (removedPrintings.has(c.pkey)) continue
    plus(ownedByCard.any, c.cardId, c.quantity)
    plus(ownedByArt.any, c.imageId, c.quantity)
    plus(ownedByPrinting, c.pkey, c.quantity)
    if (byKey.get(c.pkey)?.qualifies) {
      plus(ownedByCard.rule, c.cardId, c.quantity)
      plus(ownedByArt.rule, c.imageId, c.quantity)
    }
  }
  const cheapestByCard = tally<number>()
  for (const p of live) {
    const price = usablePrice(p)
    if (price === null) continue
    lowest(cheapestByCard.any, p.cardId, price)
    if (p.qualifies) lowest(cheapestByCard.rule, p.cardId, price)
  }

  const result: SlotResult = {
    slots: [],
    ownedSlots: 0,
    missingSlots: 0,
    valueToFinish: 0,
    unpricedMissing: 0
  }
  for (const plan of plans.values()) {
    const fill = plan.added ? 'any' : 'rule'
    let owned: number | undefined
    if (plan.level === 'printing') owned = ownedByPrinting.get(plan.printing?.pkey ?? '')
    else if (plan.level === 'art') owned = ownedByArt[fill].get(plan.imageId ?? 0)
    else owned = ownedByCard[fill].get(plan.cardId)

    let price: number | null = null
    if (owned) result.ownedSlots++
    else if (goal !== 'none') {
      price =
        (plan.level === 'printing' && plan.printing
          ? usablePrice(plan.printing)
          : cheapestByCard[fill].get(plan.cardId)) ?? null
      result.missingSlots++
      if (price === null) result.unpricedMissing++
      else result.valueToFinish += price
    }
    result.slots.push({ ...plan, owned: owned ?? 0, price })
  }
  return result
}
