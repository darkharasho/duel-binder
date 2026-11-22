import { formatOf } from './formats'
import type { PackState } from './pack'
import { checkYgo } from './ygo/check'
import type { DeckCard, DeckSection, DeckVerdictMark, VerdictStatus, WireDeck } from './types'

export interface DeckProblem {
  key: string
  severity: 'error' | 'warning'
  message: string
  cardId?: number
  section?: DeckSection
}

export interface DeckVerdict {
  status: VerdictStatus
  badge: string
  problems: DeckProblem[]
  packVersion: string | null
}

const STALE_DAYS = 14
const DAY = 86_400_000

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to.slice(0, 10)) - Date.parse(from.slice(0, 10))) / DAY)
}

/** Sort rank within a severity: counts, copies, limits, placement, region, stale. */
function rank(key: string): number {
  const order = ['count', 'copies', 'limit', 'place', 'region', 'stale']
  const i = order.indexOf(key.split(':')[0])
  return i < 0 ? order.length : i
}

export function checkDeck(
  deck: Pick<WireDeck, 'game' | 'format' | 'cards'>,
  cards: Record<number, DeckCard>,
  pack: PackState,
  today: string
): DeckVerdict {
  const format = formatOf(deck.game, deck.format)
  const problems: DeckProblem[] = []
  let packVersion: string | null = null
  if (format && deck.game === 'ygo') {
    const ready = pack.state === 'ready' ? pack.pack : null
    const rules = ready
      ? deck.format === 'ocg'
        ? ready.formats.ocg
        : ready.formats.advanced
      : null
    problems.push(...checkYgo(deck, format, cards, rules, today))
    if (ready) {
      packVersion = ready.version
      if (daysBetween(ready.builtAt, today) > STALE_DAYS) {
        problems.push({
          key: 'stale',
          severity: 'warning',
          message: `The ban list here is from ${ready.builtAt.slice(0, 10)} and may be out of date`
        })
      }
    }
  }
  const sorted = problems
    .map((p, i) => ({ p, i }))
    .sort((a, b) => {
      const sev = (a.p.severity === 'error' ? 0 : 1) - (b.p.severity === 'error' ? 0 : 1)
      return sev || rank(a.p.key) - rank(b.p.key) || a.i - b.i
    })
    .map((x) => x.p)
  const warnings = sorted.filter((p) => p.severity === 'warning').length
  let status: VerdictStatus
  let badge: string
  if (sorted.some((p) => p.severity === 'error')) {
    status = 'illegal'
    badge = 'Not legal'
  } else if (pack.state === 'missing') {
    status = 'unknown'
    badge = 'Legality unknown'
  } else if (pack.state === 'tooNew') {
    status = 'update'
    badge = 'Update to check legality'
  } else if (warnings > 0) {
    status = 'warnings'
    badge = `Legal · ${warnings} ${warnings === 1 ? 'warning' : 'warnings'}`
  } else {
    status = 'legal'
    badge = 'Legal'
  }
  return { status, badge, problems: sorted, packVersion }
}

export function verdictMark(v: DeckVerdict): DeckVerdictMark | null {
  if (v.packVersion === null) return null
  return { status: v.status, problems: v.problems.map((p) => p.key), packVersion: v.packVersion }
}

/** Non-null only when a newer pack flipped the deck between legal and not legal. */
export function verdictChange(
  seen: DeckVerdictMark | null,
  v: DeckVerdict
): { version: string; added: DeckProblem[]; cleared: string[] } | null {
  if (!seen || v.packVersion === null || seen.packVersion === v.packVersion) return null
  if ((seen.status === 'illegal') === (v.status === 'illegal')) return null
  const had = new Set(seen.problems)
  const has = new Set(v.problems.map((p) => p.key))
  return {
    version: v.packVersion,
    added: v.problems.filter((p) => !had.has(p.key)),
    cleared: seen.problems.filter((k) => !has.has(k))
  }
}
