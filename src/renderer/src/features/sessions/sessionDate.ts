import { formatUsd } from '@/lib/format'
import { sessionTotal, type ScanSession } from '@shared/scanSessions'
import { choosePulls, type PullCandidate, type ReplaySource } from '../scan/replay/pulls'
import { plural } from '../scan/scanText'

const sameDay = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate()

const clock = (d: Date): string =>
  d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(/\s/g, ' ')

/** "Nov 2", with the year when it isn't this one: sessions are kept forever. */
const dayOf = (d: Date, now = new Date()): string =>
  d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(d.getFullYear() !== now.getFullYear() && { year: 'numeric' })
  })

/** "Today · 9:42 PM", "Yesterday · 8:15 PM", else "Nov 2 · 8:15 PM". */
export function sessionDate(iso: string, now = new Date()): string {
  const d = new Date(iso)
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
  const day = sameDay(d, now) ? 'Today' : sameDay(d, yesterday) ? 'Yesterday' : dayOf(d, now)
  return `${day} · ${clock(d)}`
}

/** A tile and the replay both identify a card by this. */
export const sessionCardKey = (c: { cardId: number; pkey: string; addedAt: number }): string =>
  `${c.cardId}:${c.pkey}:${c.addedAt}`

/** A replay source from a saved session: its saved prices, and its own date in the header. */
export function replaySourceOfSession(s: ScanSession): ReplaySource {
  const candidates: PullCandidate[] = []
  for (const c of s.cards) {
    candidates.push({
      key: sessionCardKey(c),
      name: c.name,
      imageId: c.imageId,
      photoId: c.photoId,
      rarity: c.rarity,
      setCode: c.setCode,
      price: c.price,
      quantity: c.quantity,
      addedAt: c.addedAt,
      guess: c.guess
    })
  }
  const cards = s.cards.reduce((n, c) => n + c.quantity, 0)
  const date = dayOf(new Date(s.createdAt))
  return {
    pulls: choosePulls(candidates, s.game),
    header: `${date} · ${plural(cards, 'card', 'cards')} · ${formatUsd(sessionTotal(s.cards).value)}`
  }
}
