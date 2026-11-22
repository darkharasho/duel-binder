import type { DeckProblem } from '../check'
import type { DeckFormat } from '../formats'
import type { YgoFormatRules } from '../pack'
import type { DeckCard, DeckSection, WireDeck } from '../types'

const EXTRA_KINDS: Record<string, string> = {
  fusion: 'Fusion Monster',
  synchro: 'Synchro Monster',
  xyz: 'Xyz Monster',
  link: 'Link Monster',
  fusion_pendulum: 'Pendulum Fusion Monster',
  synchro_pendulum: 'Pendulum Synchro Monster',
  xyz_pendulum: 'Pendulum Xyz Monster'
}

const SHORT: Record<string, { label: string; region: string }> = {
  advanced: { label: 'Advanced', region: 'the TCG' },
  ocg: { label: 'OCG', region: 'the OCG' }
}
const LIMIT_WORD = ['Forbidden', 'Limited to 1', 'Semi-Limited to 2']

export function checkYgo(
  deck: Pick<WireDeck, 'format' | 'cards'>,
  format: DeckFormat,
  cards: Record<number, DeckCard>,
  rules: YgoFormatRules | null,
  today: string
): DeckProblem[] {
  const out: DeckProblem[] = []
  const short = SHORT[deck.format] ?? { label: format.label, region: 'the TCG' }
  const nameOf = (id: number): string => cards[id]?.name ?? `Card #${id}`

  const perSection: Record<DeckSection, number> = { main: 0, extra: 0, side: 0 }
  const perCard = new Map<number, number>()
  for (const e of deck.cards) {
    perSection[e.section] += e.qty
    perCard.set(e.card, (perCard.get(e.card) ?? 0) + e.qty)
  }

  for (const s of format.sections) {
    const n = perSection[s.id]
    if (n < s.min) {
      out.push({
        key: `count:${s.id}`,
        severity: 'error',
        section: s.id,
        message: `${s.label} has ${n} cards; it needs at least ${s.min}`
      })
    } else if (n > s.max) {
      out.push({
        key: `count:${s.id}`,
        severity: 'error',
        section: s.id,
        message: `${s.label} has ${n} cards; the limit is ${s.max}`
      })
    }
  }

  for (const [id, n] of perCard) {
    if (n > 3) {
      out.push({
        key: `copies:${id}`,
        severity: 'error',
        cardId: id,
        message: `${n} × ${nameOf(id)}: at most 3 copies across Main, Extra and Side`
      })
    }
    const cap = rules?.limits[String(id)]
    if (cap !== undefined && n > cap) {
      out.push({
        key: `limit:${id}`,
        severity: 'error',
        cardId: id,
        message: `${n} × ${nameOf(id)}: ${LIMIT_WORD[cap]} in ${short.label}`
      })
    }
  }

  const seenPlace = new Set<string>()
  for (const e of deck.cards) {
    const c = cards[e.card]
    if (!c) continue
    const key = `place:${e.card}:${e.section}`
    if (seenPlace.has(key)) continue
    const kind = EXTRA_KINDS[c.frameType]
    if (kind && e.section === 'main') {
      seenPlace.add(key)
      out.push({
        key,
        severity: 'error',
        cardId: e.card,
        section: 'main',
        message: `${c.name} is a ${kind} and belongs in the Extra Deck`
      })
    } else if (!kind && e.section === 'extra') {
      seenPlace.add(key)
      out.push({
        key,
        severity: 'error',
        cardId: e.card,
        section: 'extra',
        message: `${c.name} can't go in the Extra Deck`
      })
    }
  }

  if (rules) {
    for (const id of perCard.keys()) {
      const k = String(id)
      if (!(k in rules.notReleased)) continue
      const date = rules.notReleased[k]
      if (date !== null && date <= today) continue
      out.push({
        key: `region:${id}`,
        severity: 'warning',
        cardId: id,
        message: date
          ? `${nameOf(id)} comes out in ${short.region} on ${date}`
          : `${nameOf(id)} isn't out in ${short.region} yet`
      })
    }
  }
  return out
}
