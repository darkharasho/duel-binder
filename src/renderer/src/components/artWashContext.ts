import { createContext, useContext, useEffect, useRef } from 'react'
import { useGame } from '@/lib/game'
import type { Families } from '@/lib/wash/families'
import { type WashCard, gameFallback, rememberedCard, sampleCard } from '@/lib/wash/sample'

export interface WashState {
  families: Families
  seed: number
  strength: number
}

export const ArtWashContext = createContext<((w: WashState | null) => void) | null>(null)

/** A pick landing later than this after the page opened is dropped. */
export const PICK_DEADLINE_MS = 6000
/** A page still without cards this long after opening counts as empty and gets a wash of its own. */
export const EMPTY_WASH_MS = 1200
/** Unreadable cards tolerated in one visit before settling on the game's colours. */
export const MAX_MISSES = 6

/** A Fisher-Yates shuffle of the first `limit` items. */
export function pickOrder<T>(xs: T[], rand: () => number, limit = 24): T[] {
  const out = xs.slice(0, limit)
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/**
 * Washes the app in the colours of one random card from `cards`, picked once per visit.
 * `undefined` leaves it to a child view; `null` or `[]` (still loading) keeps what is showing, and
 * if the page is still empty after EMPTY_WASH_MS it takes the colours of a card read on an earlier
 * visit (or the game's colours in a fresh layout), so an empty page doesn't look the same every time.
 * Cards arriving after that still get their own pick.
 */
export function useArtWash(
  cards: WashCard[] | null | undefined,
  opts?: { strength?: number }
): void {
  const set = useContext(ArtWashContext)
  const { game } = useGame()
  const picked = useRef(false)
  const filled = useRef(false)
  const generation = useRef(0)
  const strength = opts?.strength ?? 1

  useEffect(() => {
    return () => {
      // Tear-down (unmount or StrictMode's simulated one): drop any walk in flight and allow a new pick.
      generation.current++
      picked.current = false
      filled.current = false
    }
  }, [])

  useEffect(() => {
    if (cards === undefined || (cards && cards.length > 0) || !set) return
    if (picked.current || filled.current) return
    const t = setTimeout(() => {
      if (picked.current || filled.current) return
      filled.current = true
      const kept = rememberedCard(game, Math.random)
      set(
        kept
          ? { families: kept.families, seed: kept.imageId, strength }
          : {
              families: gameFallback(game, Math.random),
              seed: 1 + Math.floor(Math.random() * 1e6),
              strength
            }
      )
    }, EMPTY_WASH_MS)
    return () => clearTimeout(t)
  }, [cards, set, game, strength])

  useEffect(() => {
    // A child view took over (a set or binder opened): drop the list's walk so it can't land late.
    if (cards === undefined) generation.current++
  }, [cards])

  useEffect(() => {
    if (!cards || cards.length === 0 || !set || picked.current) return
    picked.current = true
    const mine = generation.current
    const order = pickOrder(cards, Math.random)
    const started = Date.now()
    let misses = 0
    void (async () => {
      let first: { card: WashCard; families: Families } | null = null
      let chosen: { card: WashCard; families: Families } | null = null
      for (const card of order) {
        const families = await sampleCard(card, game)
        if (generation.current !== mine) return
        // Too slow: keep the wash showing rather than cross-fading while someone is using the page.
        if (Date.now() - started > PICK_DEADLINE_MS) return
        if (!families) {
          if (++misses >= MAX_MISSES) break
          continue
        }
        first ??= { card, families }
        if (!families.greyArt && families.fams?.length !== 0) {
          chosen = { card, families }
          break
        }
      }
      const pick = chosen ?? first
      if (pick) set({ families: pick.families, seed: pick.card.imageId, strength })
      else set({ families: gameFallback(game), seed: order[0].imageId, strength })
    })()
  }, [cards, set, game, strength])
}
