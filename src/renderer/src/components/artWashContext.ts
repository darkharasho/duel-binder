import { createContext, useContext, useEffect, useRef } from 'react'
import { useGame } from '@/lib/game'
import { cardImageSrc, setImageSrc } from '@/lib/images'
import type { Families } from '@/lib/wash/families'
import { type WashCard, gameFallback, sampleCard } from '@/lib/wash/sample'

/** Sets the image (an image URL from `lib/images`) whose blurred colours tint the top of the app; null for none. */
export const ArtWashSrcContext = createContext<((src: string | null) => void) | null>(null)

/** Tints the app with `src` while the calling page is shown; `undefined` leaves it to a child view. */
export function useArtWashSrc(src: string | null | undefined): void {
  const set = useContext(ArtWashSrcContext)
  useEffect(() => {
    if (src === undefined) return
    set?.(src)
    return () => set?.(null)
  }, [set, src])
}

export interface WashState {
  families: Families
  seed: number
  strength: number
}

export const ArtWashContext = createContext<((w: WashState | null) => void) | null>(null)

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
 * `undefined` leaves it to a child view; `null` or `[]` (still loading) keeps what is showing.
 */
export function useArtWash(
  cards: WashCard[] | null | undefined,
  opts?: { strength?: number }
): void {
  const set = useContext(ArtWashContext)
  const { game } = useGame()
  const picked = useRef(false)
  const generation = useRef(0)
  const strength = opts?.strength ?? 1

  useEffect(() => {
    return () => {
      // Tear-down (unmount or StrictMode's simulated one): drop any walk in flight and allow a new pick.
      generation.current++
      picked.current = false
    }
  }, [])

  useEffect(() => {
    if (!cards || cards.length === 0 || !set || picked.current) return
    picked.current = true
    const mine = generation.current
    const order = pickOrder(cards, Math.random)
    void (async () => {
      let first: { card: WashCard; families: Families } | null = null
      let chosen: { card: WashCard; families: Families } | null = null
      for (const card of order) {
        const families = await sampleCard(card, game)
        if (generation.current !== mine) return
        if (!families) continue
        first ??= { card, families }
        if (!families.greyArt) {
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

export const cardArtUrl = (imageId: number): string => cardImageSrc('small', imageId)
export const coverArtUrl = (imageId: number): string => cardImageSrc('cropped', imageId)
export const setArtUrl = (imageKey: string): string => setImageSrc(imageKey)
