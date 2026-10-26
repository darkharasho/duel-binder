import { useEffect, useRef, useState, type RefObject } from 'react'
import { ABSENT_MS } from '@shared/scan/thresholds'
import type { ScanPrinting } from '@shared/scan/types'
import { api } from '@/lib/api'
import type { ScanEngine } from './engine'
import { resolveSignals, type ScanDraft, type ScanOutcome } from './resolve'
import { createShowingTracker } from './tracker'
import type { Quad } from './vision/detect'

/** About five analyses a second. */
const FRAME_MS = 200
/** Engine failures in a row before scanning stops; each waits twice as long as the last. */
const MAX_FAILURES = 5
const FIRST_BACKOFF_MS = 500
const FLASH_MS = 120

export type ScanStatus =
  | { kind: 'idle' }
  | { kind: 'unsure' }
  | { kind: 'added'; name: string; setCode: string | null }
  | { kind: 'stopped' }

export interface ScanLoopOptions {
  videoRef: RefObject<HTMLVideoElement | null>
  engineFactory: () => ScanEngine
  /** A camera stream is up and scanning isn't paused. */
  running: boolean
  /** The picked set, or null for any set. Changing it starts a fresh showing. */
  setName: string | null
  setKey: string
  /** The picked set's printings; null for any set, undefined while they load. */
  setPrintings: ScanPrinting[] | null | undefined
  defaultRarity: string | null
  onDraft: (d: ScanDraft) => void
}

export interface ScanLoop {
  status: ScanStatus
  /** The card's outline in frame pixels, and the frame's size, for drawing over the video. */
  outline: { quad: Quad; width: number; height: number } | null
  /** null until the engine has been given the fingerprint file (or found there is none). */
  artReady: boolean | null
  flash: boolean
}

const sameStatus = (a: ScanStatus, b: ScanStatus): boolean =>
  a.kind === b.kind &&
  (a.kind !== 'added' || (b.kind === 'added' && a.name === b.name && a.setCode === b.setCode))

/** A fresh copy of the video's current frame; the engine takes ownership of its pixels. */
function grab(video: HTMLVideoElement, canvas: HTMLCanvasElement): ImageData | null {
  const width = video.videoWidth
  const height = video.videoHeight
  if (!width || !height) return null
  if (canvas.width !== width) canvas.width = width
  if (canvas.height !== height) canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(video, 0, 0, width, height)
  return ctx.getImageData(0, 0, width, height)
}

/**
 * Runs the scan engine over the camera, one frame at a time, and turns what it sees into counted
 * cards (onDraft) and the status bar's state. The engine is made on mount and disposed on
 * unmount. When an analysis fails (say the worker crashed), the engine is given the fingerprints
 * again before the next frame, after a growing pause; after MAX_FAILURES in a row it stops.
 */
export function useScanLoop(opts: ScanLoopOptions): ScanLoop {
  const [status, setStatusState] = useState<ScanStatus>({ kind: 'idle' })
  const [outline, setOutline] = useState<ScanLoop['outline']>(null)
  const [artReady, setArtReady] = useState<boolean | null>(null)
  const [flash, setFlash] = useState(false)

  const latest = useRef(opts)
  useEffect(() => {
    latest.current = opts
  })

  const engineRef = useRef<ScanEngine | null>(null)
  const readyRef = useRef(false)
  const reinit = useRef<(() => Promise<void>) | null>(null)
  const tracker = useRef(createShowingTracker())
  const loop = useRef({
    busy: false,
    needsInit: false,
    failures: 0,
    retryAt: 0,
    stopped: false,
    lastFound: false,
    shown: null as number | null,
    absentSince: null as number | null,
    status: { kind: 'idle' } as ScanStatus
  })

  const setStatus = (next: ScanStatus): void => {
    if (sameStatus(loop.current.status, next)) return
    loop.current.status = next
    setStatusState(next)
  }

  // The engine, and the fingerprints it matches art against.
  useEffect(() => {
    let live = true
    const showings = tracker.current
    const engine = latest.current.engineFactory()
    engineRef.current = engine
    readyRef.current = false
    const init = async (): Promise<void> => {
      const fp = await api.scan.fingerprints().catch(() => null)
      if (!live) return
      setArtReady(fp !== null)
      await engine.init(fp)
    }
    reinit.current = init
    void (async () => {
      // Offline or failed downloads still leave any file already on disk.
      await api.scan.refreshFingerprints().catch(() => null)
      if (!live) return
      try {
        await init()
      } catch {
        loop.current.needsInit = true
      }
      if (live) readyRef.current = true
    })()
    return () => {
      live = false
      readyRef.current = false
      reinit.current = null
      engineRef.current = null
      showings.reset()
      engine.dispose()
    }
  }, [])

  // A new set is a new start: nothing counted yet, nothing in view.
  useEffect(() => {
    const l = loop.current
    tracker.current.reset()
    l.lastFound = false
    l.shown = null
    l.absentSince = null
    l.status = { kind: 'idle' }
    setStatusState(l.status)
  }, [opts.setKey])

  useEffect(() => {
    if (!opts.running) return
    let live = true
    let flashTimer: ReturnType<typeof setTimeout> | undefined
    const canvas = document.createElement('canvas')
    const l = loop.current

    const fail = (): void => {
      l.failures++
      l.needsInit = true
      l.lastFound = false
      if (l.failures >= MAX_FAILURES) {
        l.stopped = true
        setStatus({ kind: 'stopped' })
      } else {
        l.retryAt = Date.now() + FIRST_BACKOFF_MS * 2 ** (l.failures - 1)
      }
    }

    const show = (outcome: ScanOutcome, draft: ScanDraft | null): void => {
      const now = performance.now()
      if (outcome.kind === 'none') {
        l.absentSince ??= now
        if (now - l.absentSince >= ABSENT_MS) {
          l.shown = null
          setStatus({ kind: 'idle' })
        }
        return
      }
      l.absentSince = null
      if (draft) {
        l.shown = draft.cardId
        setStatus({ kind: 'added', name: draft.name, setCode: draft.setCode })
      } else if (outcome.kind === 'unsure' && l.shown === null) {
        setStatus({ kind: 'unsure' })
      }
    }

    const tick = async (): Promise<void> => {
      const engine = engineRef.current
      const o = latest.current
      const video = o.videoRef.current
      if (l.busy || l.stopped || !engine || !readyRef.current || document.hidden) return
      if (Date.now() < l.retryAt || o.setPrintings === undefined) return
      if (!video || video.readyState < 2) return
      l.busy = true
      try {
        if (l.needsInit) {
          try {
            await reinit.current?.()
            l.needsInit = false
          } catch {
            fail()
            return
          }
        }
        const frame = grab(video, canvas)
        if (!frame || !live) return
        // Read before the pixels are handed over.
        const { width, height } = frame
        const setPrintings = o.setPrintings
        const candidates = setPrintings
          ? [...new Set(setPrintings.flatMap((p) => p.imageIds))]
          : null
        let raw
        try {
          raw = await engine.analyze(frame, { candidates, wantText: l.lastFound })
        } catch {
          if (live) fail()
          return
        }
        if (!live) return
        l.failures = 0
        l.lastFound = raw.found
        setOutline(raw.found && raw.quad ? { quad: raw.quad, width, height } : null)
        const outcome = await resolveSignals(raw, {
          setName: o.setName,
          setPrintings,
          defaultRarity: o.defaultRarity,
          lookups: api.scan
        }).catch(() => null)
        // The set changed mid-frame: this frame belongs to the old one.
        if (!outcome || !live || latest.current.setKey !== o.setKey) return
        const draft = tracker.current.push(performance.now(), outcome)
        show(outcome, draft)
        if (draft) {
          latest.current.onDraft(draft)
          setFlash(true)
          clearTimeout(flashTimer)
          flashTimer = setTimeout(() => setFlash(false), FLASH_MS)
        }
      } finally {
        l.busy = false
      }
    }

    const timer = setInterval(() => void tick(), FRAME_MS)
    return () => {
      live = false
      clearInterval(timer)
      clearTimeout(flashTimer)
      l.lastFound = false
      setOutline(null)
      setFlash(false)
    }
  }, [opts.running])

  return { status, outline, artReady, flash }
}
