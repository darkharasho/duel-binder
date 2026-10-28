import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { cuesOver, type RarityCues } from '@shared/scan/rarity'
import type { CardLanguage } from '@shared/scan/language'
import { ABSENT_MS, LANGUAGE_MAX_READS, RARITY_MAX_READINGS } from '@shared/scan/thresholds'
import type { OcrBand, ScanPrinting } from '@shared/scan/types'
import type { ScanStatus } from '@shared/scanWindow'
import { api } from '@/lib/api'
import { centreCrop } from './crop'
import type { ScanEngine } from './engine'
import { resolveSignals, withRarityByLook, type ScanDraft, type ScanOutcome } from './resolve'
import { createShowingTracker } from './tracker'
import type { Quad } from './vision/detect'

/** About five analyses a second. */
const FRAME_MS = 200
/** Engine failures in a row before scanning stops; each waits twice as long as the last. */
const MAX_FAILURES = 5
const FIRST_BACKOFF_MS = 500
/**
 * Budgets for the main-process calls a frame waits on, so a call that never settles can't hold
 * the loop (which skips frames while one is in flight) forever. Telling a card's language reads
 * up to three models, each maybe starting cold, so it gets the most; past it the language counts
 * as unknown.
 */
const FINGERPRINTS_TIMEOUT_MS = 20_000
const LOOKUP_TIMEOUT_MS = 30_000
const LANGUAGE_TIMEOUT_MS = 20_000
/**
 * A shown camera whose picture hasn't moved for this long is taken as frozen (a stream the
 * system muted in the background, or one that died without ending) and handed to onStalled.
 */
const STALL_MS = 5000

/** p, or a rejection once ms pass. */
function within<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Timed out')), ms)
  })
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer))
}

export type { ScanStatus }

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
  /** The camera's picture stopped moving; reopening the camera is the cure. */
  onStalled?: () => void
}

export interface ScanLoop {
  status: ScanStatus
  /** After scanning stopped on errors: starts over with a fresh init. */
  retry: () => void
  /** The card's outline in the scanned crop's pixels, and the crop's size, for drawing over the preview. */
  outline: { quad: Quad; width: number; height: number } | null
  /** null until the engine has been given the fingerprint file (or found there is none). */
  artReady: boolean | null
}

const sameStatus = (a: ScanStatus, b: ScanStatus): boolean =>
  a.kind === b.kind &&
  (a.kind !== 'added' || (b.kind === 'added' && a.name === b.name && a.setCode === b.setCode))

/**
 * The part of the video's current frame the preview shows (its centre crop), at full camera
 * resolution, as a bitmap for the engine to hand to its worker: the pixels are never copied on
 * the UI thread.
 */
async function grab(
  video: HTMLVideoElement
): Promise<{ frame: ImageBitmap; width: number; height: number } | null> {
  if (!video.videoWidth || !video.videoHeight) return null
  const { x, y, width, height } = centreCrop(video.videoWidth, video.videoHeight)
  return { frame: await createImageBitmap(video, x, y, width, height), width, height }
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

  // The picked set's artworks, worked out once per set rather than per frame.
  const candidates = useMemo(
    () => (opts.setPrintings ? [...new Set(opts.setPrintings.flatMap((p) => p.imageIds))] : null),
    [opts.setPrintings]
  )
  const latest = useRef({ ...opts, candidates })
  useEffect(() => {
    latest.current = { ...opts, candidates }
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
    // When the video's picture last moved, to tell a frozen camera.
    videoTime: -1,
    movedAt: 0,
    // What the card in view has shown of its foil in its latest frames.
    looks: { cardId: null as number | null, cues: [] as RarityCues[] },
    // What the card in view's text has read as, and how many times it has been read.
    language: { cardId: null as number | null, reads: 0, read: null as CardLanguage | null },
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
      // Only a hang fails the init (and is retried); a file that can't be read means no art.
      const fp = await within(
        api.scan.fingerprints().catch(() => null),
        FINGERPRINTS_TIMEOUT_MS
      )
      if (!live) return
      setArtReady(fp !== null)
      await engine.init(fp)
    }
    reinit.current = init
    void (async () => {
      // Scanning starts at once with whatever file is on disk: set codes and names need no
      // network, and a slow download mustn't hold them up.
      try {
        await init()
      } catch {
        loop.current.needsInit = true
      }
      if (!live) return
      readyRef.current = true
      // A newer file, once downloaded, goes to the engine between frames.
      const refreshed = await api.scan.refreshFingerprints().catch(() => null)
      if (live && refreshed?.updated) loop.current.needsInit = true
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
    l.looks = { cardId: null, cues: [] }
    l.language = { cardId: null, reads: 0, read: null }
    // Stopped stays stopped until Retry.
    if (l.stopped) return
    l.status = { kind: 'idle' }
    setStatusState(l.status)
  }, [opts.setKey])

  const retry = useCallback(() => {
    const l = loop.current
    l.stopped = false
    l.failures = 0
    l.needsInit = true
    l.retryAt = 0
    l.status = { kind: 'idle' }
    setStatusState(l.status)
  }, [])

  useEffect(() => {
    if (!opts.running) return
    let live = true
    const l = loop.current

    /**
     * Counts a failed frame. An engine failure gives the engine its fingerprints again first; a
     * failed lookup only counts, so a main process that keeps failing stops scanning visibly
     * rather than leaving a live camera that never finds anything.
     */
    const fail = ({ reinit = true } = {}): void => {
      l.failures++
      if (reinit) {
        l.needsInit = true
        l.lastFound = false
      }
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

    /**
     * The outcome with the rarity its card's look picks over the latest frames it has been
     * recognized in, so the draft that counts carries what all of them saw.
     */
    const withLook = (outcome: ScanOutcome, cues: RarityCues | null): ScanOutcome => {
      if (outcome.kind === 'none') l.looks = { cardId: null, cues: [] }
      if (outcome.kind !== 'recognized') return outcome
      const { cardId } = outcome.item
      if (l.looks.cardId !== cardId) l.looks = { cardId, cues: [] }
      if (cues) l.looks.cues = [...l.looks.cues, cues].slice(-RARITY_MAX_READINGS)
      const look = cuesOver(l.looks.cues)
      return {
        ...outcome,
        item: withRarityByLook(outcome.item, look, latest.current.defaultRarity)
      }
    }

    /**
     * The language the card's text reads as. Reading it is slow, so a card's answer is kept while
     * it stays in view, and a card whose text can't be told is tried on LANGUAGE_MAX_READS frames.
     */
    const languageOf = async (cardId: number, bands: OcrBand[]): Promise<CardLanguage | null> => {
      if (l.language.cardId !== cardId) l.language = { cardId, reads: 0, read: null }
      const known = l.language
      if (known.read || known.reads >= LANGUAGE_MAX_READS || !bands.length) return known.read
      known.reads++
      known.read = await within(api.scan.language(bands), LANGUAGE_TIMEOUT_MS).catch(() => null)
      return known.read
    }

    /** Calls onStalled when the shown camera's picture hasn't moved for STALL_MS. */
    const watch = (video: HTMLVideoElement | null): void => {
      const now = Date.now()
      // Hidden, the picture may rightly stand still; the clock starts again once shown.
      if (!video || document.visibilityState !== 'visible' || video.currentTime !== l.videoTime) {
        l.videoTime = video?.currentTime ?? -1
        l.movedAt = now
      } else if (now - l.movedAt >= STALL_MS) {
        l.movedAt = now
        latest.current.onStalled?.()
      }
    }

    const tick = async (): Promise<void> => {
      const engine = engineRef.current
      const o = latest.current
      const video = o.videoRef.current
      watch(video)
      // Not skipped while document.hidden: the scan window is often covered while streaming.
      if (l.busy || l.stopped || !engine || !readyRef.current) return
      if (Date.now() < l.retryAt || o.setPrintings === undefined) return
      if (!video || video.readyState < 2) return
      l.busy = true
      try {
        if (l.needsInit) {
          // Cleared first, so a newer file that arrives mid-init asks again.
          l.needsInit = false
          try {
            await reinit.current?.()
          } catch {
            fail()
            return
          }
        }
        const grabbed = await grab(video).catch(() => null)
        if (!grabbed) return
        if (!live) {
          grabbed.frame.close()
          return
        }
        const { frame, width, height } = grabbed
        const setPrintings = o.setPrintings
        const candidates = o.candidates
        let raw
        try {
          raw = await engine.analyze(frame, { candidates, wantText: l.lastFound })
        } catch {
          if (live) fail()
          return
        }
        if (!live) return
        l.lastFound = raw.found
        let outcome: ScanOutcome
        try {
          outcome = await within(
            resolveSignals(raw, {
              setName: o.setName,
              setPrintings,
              defaultRarity: o.defaultRarity,
              cardLanguage: (cardId) => languageOf(cardId, raw.textBands),
              lookups: api.scan
            }),
            LOOKUP_TIMEOUT_MS
          )
        } catch {
          if (live) fail({ reinit: false })
          return
        }
        l.failures = 0
        // The set changed mid-frame: this frame belongs to the old one.
        if (!live || latest.current.setKey !== o.setKey) return
        // Something card-shaped that is no card gets no outline either.
        setOutline(
          raw.found && raw.quad && outcome.kind !== 'none'
            ? { quad: raw.quad, width, height }
            : null
        )
        const draft = tracker.current.push(performance.now(), withLook(outcome, raw.cues))
        show(outcome, draft)
        if (draft) latest.current.onDraft(draft)
      } finally {
        l.busy = false
      }
    }

    l.movedAt = Date.now()
    const timer = setInterval(() => void tick(), FRAME_MS)
    return () => {
      live = false
      clearInterval(timer)
      l.lastFound = false
      setOutline(null)
    }
  }, [opts.running])

  return { status, retry, outline, artReady }
}
