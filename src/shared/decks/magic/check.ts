import { MAX_PROBLEM_KEY, type DeckProblem } from '../check'
import type { DeckFormat } from '../formats'
import { mtgLegality, type MtgFormat, type MtgRulesPack } from '../pack'
import type { DeckCard, DeckSection, WireDeck } from '../types'

/** "2026-11-27" → "Nov 27" */
function shortDate(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC'
  })
}

/** Whether a and b (commander kinds, with their names) may be commanders together. */
export function validPair(
  a: { name: string; kind: string },
  b: { name: string; kind: string }
): boolean {
  const withName = (x: { kind: string }): string | null =>
    x.kind.startsWith('partner-with:') ? x.kind.slice('partner-with:'.length) : null
  if (a.kind === 'partner' && b.kind === 'partner') return true
  if (withName(a) === b.name || withName(b) === a.name) return true
  if (a.kind === 'friends' && b.kind === 'friends') return true
  const kinds = [a.kind, b.kind]
  const has = (k: string): boolean => kinds.includes(k)
  if (has('background-chooser') && has('background')) return true
  if (has('companion') && has('doctor')) return true
  return a.kind.startsWith('variant:') && a.kind === b.kind
}

const SECTIONS: DeckSection[] = ['main', 'extra', 'side', 'leader', 'commander']

export function checkMtg(
  deck: Pick<WireDeck, 'format' | 'cards'>,
  format: DeckFormat,
  cards: Record<number, DeckCard>,
  pack: MtgRulesPack | null,
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
  const commander = format.id === 'commander'
  const nameOf = (c: DeckCard): string => c.mtgName ?? c.name
  const isBasic = (c: DeckCard): boolean => {
    const front = c.mtgTypeLine?.split(' // ')[0] ?? ''
    return front.includes('Basic') && front.includes('Land')
  }

  const perSection = Object.fromEntries(SECTIONS.map((s) => [s, 0])) as Record<DeckSection, number>
  /** English name → copies across every section, and the first card id seen for it */
  const byName = new Map<string, { n: number; id: number; card: DeckCard }>()
  for (const e of deck.cards) {
    perSection[e.section] += e.qty
    const c = cards[e.card]
    if (!c) continue
    const g = byName.get(nameOf(c))
    if (g) g.n += e.qty
    else byName.set(nameOf(c), { n: e.qty, id: e.card, card: c })
  }

  // Counts. Commander's Main size is covered by the exact-100 total instead of its own 98-99 rule,
  // so one wrong count is reported once.
  for (const s of format.sections) {
    if (commander && s.id === 'main') continue
    const n = perSection[s.id]
    if (n >= s.min && n <= s.max) continue
    const need =
      s.id === 'commander'
        ? 'it needs 1 or 2'
        : n < s.min
          ? `it needs at least ${s.min}`
          : `at most ${s.max}`
    push({
      key: `count:${s.id}`,
      severity: 'error',
      section: s.id,
      message:
        s.id === 'side'
          ? `Sideboard has ${n} cards; at most ${s.max}`
          : `${s.label} has ${n} cards; ${need}`
    })
  }
  const total = Object.values(perSection).reduce((a, b) => a + b, 0)
  // With an empty Commander zone, count:commander already says what's missing.
  if (commander && perSection.commander > 0 && total !== 100)
    push({
      key: 'count:total',
      severity: 'error',
      message: `The deck has ${total} cards; Commander needs exactly 100`
    })

  // Copies, grouped by English name.
  for (const [name, g] of byName) {
    if (isBasic(g.card)) continue
    const anyCap =
      pack && Object.prototype.hasOwnProperty.call(pack.anyNumber, name)
        ? pack.anyNumber[name]
        : null
    if (anyCap === 0) continue
    const limit = anyCap ?? (commander ? 1 : 4)
    if (g.n <= limit) continue
    push({
      key: `copies:${g.id}`,
      severity: 'error',
      cardId: g.id,
      message:
        anyCap !== null
          ? `${g.n} × ${name}: at most ${anyCap} copies`
          : commander
            ? `${g.n} × ${name}: Commander allows 1 copy`
            : `${g.n} × ${name}: at most 4 copies`
    })
  }

  // Colour identity: Main cards against the commanders' union.
  const commanders = deck.cards.filter((e) => e.section === 'commander').map((e) => cards[e.card])
  const resolved = commanders.length > 0 && commanders.every((c) => c !== undefined)
  if (commander && resolved) {
    const colours = new Set(commanders.flatMap((c) => c.mtgColorIdentity))
    const done = new Set<number>()
    for (const e of deck.cards) {
      const c = cards[e.card]
      if (e.section !== 'main' || !c || done.has(e.card)) continue
      done.add(e.card)
      if (c.mtgColorIdentity.every((x) => colours.has(x))) continue
      push({
        key: `color:${e.card}`,
        severity: 'error',
        cardId: e.card,
        section: 'main',
        message: `${nameOf(c)} is outside your commander's colour identity`
      })
    }
  }

  if (!pack) return out
  const fmt = format.id as MtgFormat

  let unsure = 0
  for (const [name, g] of byName) {
    const from = Object.prototype.hasOwnProperty.call(pack.upcoming, name)
      ? pack.upcoming[name]
      : null
    if (from !== null && today < from) {
      push({
        key: `soon:${g.id}`,
        severity: 'warning',
        cardId: g.id,
        message: `${name} isn't out until ${shortDate(from)}`
      })
      continue
    }
    const legal = mtgLegality(pack, name, fmt)
    if (legal === null) unsure += g.n
    else if (legal === 3)
      push({
        key: `banned:${g.id}`,
        severity: 'error',
        cardId: g.id,
        message: `${name} is banned in ${format.label}`
      })
    else if (legal === 0)
      push({
        key: `legal:${g.id}`,
        severity: 'error',
        cardId: g.id,
        message: `${name} isn't legal in ${format.label}`
      })
    else if (legal === 2 && fmt === 'vintage' && g.n > 1)
      push({
        key: `limit:${g.id}`,
        severity: 'error',
        cardId: g.id,
        message: `${g.n} × ${name}: restricted to 1 in Vintage`
      })
  }
  if (unsure > 0)
    push({
      key: 'unsure',
      severity: 'warning',
      message: `Couldn't check ${unsure} ${unsure === 1 ? 'card' : 'cards'}`
    })

  // Commander eligibility and pairing.
  if (commander && resolved) {
    const kindOf = (c: DeckCard): string | null =>
      Object.prototype.hasOwnProperty.call(pack.commander, nameOf(c))
        ? pack.commander[nameOf(c)]
        : null
    const lone = commanders.length === 1
    let allEligible = true
    for (const c of new Set(commanders)) {
      const kind = kindOf(c)
      if (kind !== null && !(lone && kind === 'background')) continue
      allEligible = false
      push({
        key: `commander:${c.id}`,
        severity: 'error',
        cardId: c.id,
        section: 'commander',
        message: `${nameOf(c)} can't be your commander`
      })
    }
    if (commanders.length === 2 && allEligible) {
      const [a, b] = commanders.map((c) => ({ name: nameOf(c), kind: kindOf(c) as string }))
      if (!validPair(a, b))
        push({
          key: 'pair',
          severity: 'error',
          message: `${a.name} and ${b.name} can't be commanders together`
        })
    }
  }
  return out
}
