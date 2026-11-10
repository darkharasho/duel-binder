import { useEffect, useRef, useState, type RefObject } from 'react'
import { centreCrop } from '@/features/scan/crop'
import type { EngineFactory, ScanEngine } from '@/features/scan/engine'
import type { GameId } from '@shared/games'
import { createNumberGate, frameNumber } from '@shared/scan/onePieceNumber'

/** Tries in a row a number must read on before it is offered. */
const NEED = 2
/** Tries in a row without the offered number before it is dropped: the card has gone. */
const GONE_AFTER = 4
/** Tries in a row with no read before the card just done may be offered again. */
const SKIP_CLEARS_AFTER = 3
/** Failed tries in a row before the reader gives up for this screen. */
const MAX_FAILURES = 5
/** The pause between tries, so the camera, the UI and the shutter keep their share of the phone. */
const PAUSE_MS = 250

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * Reads a One Piece card's printed number off the live camera while `active` (the camera is on
 * and nothing is typed): one frame at a time through the scan engine's vision worker and OCR, only
 * its number band. A number is offered once it reads on two tries in a row and `exists` in the
 * catalog, and dropped once it stops reading for a few tries. `skip` (the card just done) isn't
 * offered again until something else, or nothing for a while, has read. Failures stay quiet:
 * typing always works.
 */
export function useNumberReader(o: {
  video: RefObject<HTMLVideoElement | null>
  active: boolean
  game: GameId
  engineFactory: EngineFactory
  /** The catalog's set codes ("OP05", "P"), when known. */
  prefixes: readonly string[] | undefined
  exists(number: string): Promise<boolean>
  skip: string | null
  /** A change starts the reading over (Next card), with nothing offered and `skip` re-read. */
  resetKey?: number
  pauseMs?: number
}): string | null {
  const [offer, setOffer] = useState<string | null>(null)
  const latest = useRef(o)
  useEffect(() => {
    latest.current = o
  })

  // One engine for the screen, started on first use and stopped when the screen closes.
  const engine = useRef<{ engine: ScanEngine; ready: Promise<void> } | null>(null)
  useEffect(
    () => () => {
      engine.current?.engine.dispose()
      engine.current = null
    },
    []
  )

  const { active, game, resetKey } = o
  useEffect(() => {
    if (!active) return
    let live = true
    if (!engine.current) {
      const made = latest.current.engineFactory(game)
      engine.current = { engine: made, ready: made.init(null) }
      // Rejections are handled where it's awaited; this only keeps one from going unhandled.
      engine.current.ready.catch(() => undefined)
    }
    const { engine: reader, ready } = engine.current
    const gate = createNumberGate(NEED)
    let skip = latest.current.skip
    let offered: string | null = null
    let without = 0
    let empty = 0
    let failures = 0

    const tryOnce = async (): Promise<string | null> => {
      const video = latest.current.video.current
      if (!video || !video.videoWidth || !video.videoHeight || document.hidden) return null
      const { x, y, width, height } = centreCrop(video.videoWidth, video.videoHeight)
      const frame = await createImageBitmap(video, x, y, width, height)
      if (!live) {
        frame.close()
        return null
      }
      const raw = await reader.analyze(frame, { candidates: null, wantText: true, codesOnly: true })
      return frameNumber(raw.codeTexts, latest.current.prefixes)
    }

    void (async () => {
      try {
        await ready
      } catch {
        return
      }
      while (live) {
        let read: string | null = null
        try {
          read = await tryOnce()
          failures = 0
        } catch {
          if (++failures >= MAX_FAILURES) return
        }
        if (!live) return
        // The card just done stays skipped until another reads, or nothing does for a while.
        empty = read === null ? empty + 1 : 0
        if (skip && ((read !== null && read !== skip) || empty >= SKIP_CLEARS_AFTER)) skip = null
        const passed = gate.push(read === skip ? null : read)
        if (offered && read !== offered && ++without >= GONE_AFTER) {
          offered = null
          setOffer(null)
        }
        if (read === offered) without = 0
        if (passed && passed !== offered) {
          const known = await latest.current.exists(passed).catch(() => false)
          if (!live) return
          if (known) {
            offered = passed
            without = 0
            setOffer(passed)
          }
        }
        await sleep(latest.current.pauseMs ?? PAUSE_MS)
      }
    })()
    return () => {
      live = false
      // The next time it reads, it starts with nothing offered.
      setOffer(null)
    }
  }, [active, game, resetKey])

  return active ? offer : null
}
