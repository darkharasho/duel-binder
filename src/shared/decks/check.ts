import { formatOf } from './formats'
import type { PackState } from './pack'
import { checkMtg } from './magic/check'
import { checkOp } from './onepiece/check'
import { checkPkm } from './pokemon/check'
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
/** A verdict mark keeps at most this many problem keys (errors first), each at most this long. */
export const MAX_MARK_PROBLEMS = 300
export const MAX_PROBLEM_KEY = 64

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to.slice(0, 10)) - Date.parse(from.slice(0, 10))) / DAY)
}

/** Sort rank within a severity: counts, copies, limits, placement, region, stale. */
function rank(key: string): number {
  const order = [
    'count',
    'copies',
    'limit',
    'commander',
    'leader',
    'color',
    'pair',
    'rotated',
    'soon',
    'block',
    'ace',
    'radiant',
    'basic',
    'legal',
    'banned',
    'unsure',
    'place',
    'don',
    'region',
    'stale'
  ]
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
  // A format this app doesn't know (made by a newer one) can't be judged, and is never Legal.
  if (!format)
    return { status: 'update', badge: 'Update to check legality', problems: [], packVersion: null }
  const problems: DeckProblem[] = []
  let packVersion: string | null = null
  if (deck.game === 'ygo') {
    const ready = pack.state === 'ready' && pack.pack.game === 'ygo' ? pack.pack : null
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
  } else if (deck.game === 'pkm') {
    const ready = pack.state === 'ready' && pack.pack.game === 'pkm' ? pack.pack : null
    problems.push(...checkPkm(deck, format, cards, ready))
    if (ready) {
      packVersion = ready.version
      if (daysBetween(ready.builtAt, today) > STALE_DAYS) {
        problems.push({
          key: 'stale',
          severity: 'warning',
          message: `The rules here are from ${ready.builtAt.slice(0, 10)} and may be out of date`
        })
      }
    }
  } else if (deck.game === 'op') {
    const ready = pack.state === 'ready' && pack.pack.game === 'op' ? pack.pack : null
    problems.push(...checkOp(deck, format, cards, ready, today))
    if (ready) {
      packVersion = ready.version
      if (daysBetween(ready.builtAt, today) > STALE_DAYS) {
        problems.push({
          key: 'stale',
          severity: 'warning',
          message: `The rules here are from ${ready.builtAt.slice(0, 10)} and may be out of date`
        })
      }
    }
  } else if (deck.game === 'mtg') {
    const ready = pack.state === 'ready' && pack.pack.game === 'mtg' ? pack.pack : null
    problems.push(...checkMtg(deck, format, cards, ready, today))
    if (ready) {
      packVersion = ready.version
      if (daysBetween(ready.builtAt, today) > STALE_DAYS) {
        problems.push({
          key: 'stale',
          severity: 'warning',
          message: `The rules here are from ${ready.builtAt.slice(0, 10)} and may be out of date`
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
  return {
    status: v.status,
    problems: v.problems
      .map((p) => p.key)
      .filter((k) => k.length <= MAX_PROBLEM_KEY)
      .slice(0, MAX_MARK_PROBLEMS),
    packVersion: v.packVersion
  }
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
