import { MAX_PROBLEM_KEY, type DeckProblem } from '../check'
import type { DeckFormat } from '../formats'
import type { OpRulesPack } from '../pack'
import type { DeckCard, DeckSection, WireDeck } from '../types'

const LEADER = 'Leader'
const DON = 'DON!!'

/** "2026-11-27" → "Nov 27" */
function shortDate(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC'
  })
}

export function checkOp(
  deck: Pick<WireDeck, 'format' | 'cards'>,
  format: DeckFormat,
  cards: Record<number, DeckCard>,
  pack: OpRulesPack | null,
  today: string
): DeckProblem[] {
  const out: DeckProblem[] = []
  const seen = new Set<string>()
  const push = (p: DeckProblem): void => {
    const key = p.key.slice(0, MAX_PROBLEM_KEY)
    if (seen.has(key)) return
    seen.add(key)
    out.push({ ...p, key })
  }
  const numOf = (c: DeckCard): string => c.opNumber ?? String(c.id)
  const isLeader = (c: DeckCard): boolean => c.opCardType === LEADER
  const isDon = (c: DeckCard): boolean => c.opCardType === DON
  /** Card facts not read yet (a card just added from search): no number, block or colours. */
  const unread = (c: DeckCard): boolean => c.opNumber === null

  const perSection: Record<DeckSection, number> = { main: 0, extra: 0, side: 0, leader: 0 }
  /** card id → copies, per section, in deck order */
  const inLeader = new Map<number, number>()
  const inMain = new Map<number, number>()
  for (const e of deck.cards) {
    perSection[e.section] += e.qty
    const m = e.section === 'leader' ? inLeader : e.section === 'main' ? inMain : null
    m?.set(e.card, (m.get(e.card) ?? 0) + e.qty)
  }

  for (const s of format.sections) {
    const n = perSection[s.id]
    // Both One Piece sections are a fixed size (min = max).
    if (n >= s.min && n <= s.max) continue
    push({
      key: `count:${s.id}`,
      severity: 'error',
      section: s.id,
      message: `${s.label} has ${n} cards; it needs exactly ${s.min}`
    })
  }

  // A DON!! card never goes in the deck; it gets this one problem and no other.
  for (const m of [inLeader, inMain]) {
    for (const id of m.keys()) {
      const c = cards[id]
      if (c && isDon(c))
        push({
          key: `don:${id}`,
          severity: 'error',
          cardId: id,
          message: `${c.name} is a DON!! card; it doesn't go in the deck`
        })
    }
  }

  let leader: DeckCard | undefined
  for (const id of inLeader.keys()) {
    const c = cards[id]
    if (!c || isDon(c)) continue
    if (isLeader(c)) leader ??= c
    else
      push({
        key: `leader:${id}`,
        severity: 'error',
        cardId: id,
        section: 'leader',
        message: `${c.name} isn't a Leader`
      })
  }
  for (const id of inMain.keys()) {
    const c = cards[id]
    if (c && isLeader(c))
      push({
        key: `place:${id}`,
        severity: 'error',
        cardId: id,
        section: 'main',
        message: `${c.name} is a Leader; it goes in the Leader slot`
      })
  }

  // Copies and restricted counts: both sections, grouped by number.
  const byNum = new Map<string, { n: number; name: string }>()
  for (const m of [inLeader, inMain]) {
    for (const [id, qty] of m) {
      const c = cards[id]
      if (!c || isDon(c)) continue
      const g = byNum.get(numOf(c))
      if (g) g.n += qty
      else byNum.set(numOf(c), { n: qty, name: c.name })
    }
  }
  const unlimited = new Set(pack?.unlimited ?? [])
  for (const [num, g] of byNum) {
    if (g.n > 4 && !unlimited.has(num))
      push({
        key: `copies:${num}`,
        severity: 'error',
        message: `${g.n} × ${g.name} (${num}): at most 4 copies of each card`
      })
  }

  if (leader && leader.opColors.length > 0) {
    const colours = new Set(leader.opColors)
    for (const id of inMain.keys()) {
      const c = cards[id]
      if (!c || isLeader(c) || isDon(c) || c.opColors.length === 0) continue
      if (c.opColors.some((x) => colours.has(x))) continue
      push({
        key: `color:${id}`,
        severity: 'error',
        cardId: id,
        section: 'main',
        message: `${c.name} doesn't share a colour with ${leader.name}`
      })
    }
  }

  if (!pack) return out

  const standard = format.id === 'standard'
  const rules = standard ? pack.formats.standard : pack.formats.extra
  const started = (from: string | undefined): boolean => from === undefined || from <= today

  for (const b of rules.banned) {
    const g = byNum.get(b.card)
    if (!g) continue
    if (started(b.from))
      push({
        key: `banned:${b.card}`,
        severity: 'error',
        message: `${g.name} is banned in ${format.label}`
      })
    else
      push({
        key: `soon:${b.card}`,
        severity: 'warning',
        message: `${g.name} is banned from ${shortDate(b.from as string)}`
      })
  }
  for (const p of rules.bannedPairs) {
    // The pair's "leader" is a card number anywhere in the deck, Leader slot or Deck.
    const partner = byNum.get(p.leader)
    if (!partner) continue
    for (const num of p.cards) {
      const g = byNum.get(num)
      if (!g) continue
      if (started(p.from))
        push({
          key: `pair:${num}`,
          severity: 'error',
          message: `${g.name} can't be used with ${partner.name}`
        })
      else
        push({
          key: `soon:${num}`,
          severity: 'warning',
          message: `${g.name} can't be used with ${partner.name} from ${shortDate(p.from as string)}`
        })
    }
  }
  // byNum keys a card with no number by its id, which never matches a rule's card number.
  for (const [num, k] of Object.entries(rules.restricted)) {
    const g = byNum.get(num)
    if (g && g.n > k)
      push({
        key: `limit:${num}`,
        severity: 'error',
        message: `${g.n} × ${g.name}: at most ${k} in ${format.label}`
      })
  }

  if (standard) {
    const std = pack.formats.standard
    const rotated = new Set(std.rotatedBlocks)
    const exempt = new Set(std.exempt)
    let unknown = 0
    for (const m of [inLeader, inMain]) {
      for (const [id, qty] of m) {
        const c = cards[id]
        if (!c || isDon(c) || unread(c) || exempt.has(numOf(c))) continue
        const prefix = numOf(c).split('-')[0]
        const block =
          c.opBlock ??
          (Object.prototype.hasOwnProperty.call(pack.setBlocks, prefix)
            ? pack.setBlocks[prefix]
            : undefined)
        if (block === undefined) unknown += qty
        else if (rotated.has(block))
          push({
            key: `rotated:${id}`,
            severity: 'error',
            cardId: id,
            message: `${c.name} is from Block ${block}, which has left Standard`
          })
      }
    }
    if (unknown > 0)
      push({
        key: 'block',
        severity: 'warning',
        message: `Couldn't check the block of ${unknown} ${unknown === 1 ? 'card' : 'cards'}`
      })
  }
  return out
}
