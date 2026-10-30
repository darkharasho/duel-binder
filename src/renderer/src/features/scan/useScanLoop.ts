import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { GameId } from '@shared/games/types'
import type { LookModel } from '@shared/scan/look'
import { cuesOver, type RarityCues } from '@shared/scan/rarity'
import type { CardLanguage } from '@shared/scan/language'
import { pokemonLanguageOfBands, type PokemonTextLanguage } from '@shared/scan/pokemonLanguage'
import type { TextModel } from '@shared/scan/ocr'
import { scanProfile } from '@shared/scan/profiles'
import { ABSENT_MS, LANGUAGE_MAX_READS, RARITY_MAX_READINGS } from '@shared/scan/thresholds'
import type { OcrBand, ScanPrinting } from '@shared/scan/types'
import type { ScanStatus } from '@shared/scanWindow'
import { api } from '@/lib/api'
import { centreCrop } from './crop'
import type { EngineFactory, ScanEngine } from './engine'
import {
  describeLook,
  resolveSignals,
  withRarityByLook,
  type ScanDraft,
  type ScanOutcome
} from './resolve'
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
  engineFactory: EngineFactory
  /**
   * The game whose cards are scanned. Changing it throws the engine away and starts one on the
   * other game's fingerprints, so no frame is ever matched against the wrong game's art.
   */
  game: GameId
  /** A camera stream is up and scanning isn't paused. */
  running: boolean
  /** The picked set, or null for any set. Changing it starts a fresh showing. */
  setName: string | null
  setKey: string
  /** The picked set's printings; null for any set, undefined while they load. */
  setPrintings: ScanPrinting[] | null | undefined
  defaultRarity: string | null
  /**
   * The rarity look model, to read a rarity by after the name and frame rules can't, or null for
   * the rules alone. The phone scanner passes it; the desktop webcam, where it gains nothing,
   * doesn't. With it, the worker measures each frame's look features too. Yu-Gi-Oh's only: it's
   * never used on a game whose profile has no rarity look.
   */
  lookModel?: LookModel | null
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
    // What the card in view has shown of its foil in its latest frames, and their look features.
    looks: { cardId: null as number | null, cues: [] as RarityCues[], frames: [] as number[][] },
    // In development, the look model's last reading logged, so each change is logged once.
    lookLogged: '',
    // What the card in view's text has read as, and how many times it has been read.
    language: { cardId: null as number | null, reads: 0, read: null as CardLanguage | null },
    // The same for a Pokémon card, by the artwork it matched best (its card isn't known yet).
    pokemonLanguage: {
      imageId: null as number | null,
      reads: 0,
      read: null as PokemonTextLanguage
    },
    // A Pokémon card's name band as the Japanese model reads it, every read so far, by artwork.
    pokemonNames: { imageId: null as number | null, reads: [] as string[][] },
    status: { kind: 'idle' } as ScanStatus
  })

  const setStatus = (next: ScanStatus): void => {
    if (sameStatus(loop.current.status, next)) return
    loop.current.status = next
    setStatusState(next)
  }

  // The engine for the game, and the game's fingerprints it matches art against; a new game
  // gets a new engine, with nothing of the old one's frames or init carried over.
  const { game } = opts
  useEffect(() => {
    let live = true
    const showings = tracker.current
    const engine = latest.current.engineFactory(game)
    engineRef.current = engine
    readyRef.current = false
    loop.current.needsInit = false
    loop.current.lastFound = false
    const init = async (): Promise<void> => {
      // Only a hang fails the init (and is retried); a file that can't be read means no art.
      const fp = await within(
        api.scan.fingerprints(game).catch(() => null),
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
        if (live) loop.current.needsInit = true
      }
      if (!live) return
      readyRef.current = true
      // A newer file, once downloaded, goes to the engine between frames.
      const refreshed = await api.scan.refreshFingerprints(game).catch(() => null)
      if (live && refreshed?.updated) loop.current.needsInit = true
    })()
    return () => {
      live = false
      readyRef.current = false
      reinit.current = null
      engineRef.current = null
      showings.reset()
      engine.dispose()
      setOutline(null)
    }
  }, [game])

  // A new set or game is a new start: nothing counted yet, nothing in view.
  useEffect(() => {
    const l = loop.current
    tracker.current.reset()
    l.lastFound = false
    l.shown = null
    l.absentSince = null
    l.looks = { cardId: null, cues: [], frames: [] }
    l.language = { cardId: null, reads: 0, read: null }
    l.pokemonLanguage = { imageId: null, reads: 0, read: null }
    l.pokemonNames = { imageId: null, reads: [] }
    // Stopped stays stopped until Retry.
    if (l.stopped) return
    l.status = { kind: 'idle' }
    setStatusState(l.status)
  }, [opts.setKey, game])

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
    const withLook = (
      outcome: ScanOutcome,
      cues: RarityCues | null,
      features: number[] | null
    ): ScanOutcome => {
      if (outcome.kind === 'none') l.looks = { cardId: null, cues: [], frames: [] }
      if (outcome.kind !== 'recognized') return outcome
      const { cardId } = outcome.item
      if (l.looks.cardId !== cardId) l.looks = { cardId, cues: [], frames: [] }
      if (cues) l.looks.cues = [...l.looks.cues, cues].slice(-RARITY_MAX_READINGS)
      if (features) l.looks.frames = [...l.looks.frames, features].slice(-RARITY_MAX_READINGS)
      const over = cuesOver(l.looks.cues)
      const { lookModel, defaultRarity } = latest.current
      const look = lookModel ? { model: lookModel, frames: l.looks.frames } : null
      if (import.meta.env.DEV && look && defaultRarity === null) {
        const reading = JSON.stringify(describeLook(outcome.item, over, look))
        if (reading !== l.lookLogged) {
          l.lookLogged = reading
          console.debug('[scan] rarity look', reading)
        }
      }
      return {
        ...outcome,
        item: withRarityByLook(outcome.item, over, defaultRarity, look)
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

    /**
     * A Pokémon card's language: each of its text bands read once with the Japanese model and
     * once with the English one, each read judged on its own (pokemonLanguageOfBands). Kept, like languageOf, while
     * the same artwork stays in view, and tried on LANGUAGE_MAX_READS frames when it can't be
     * told; a failed read counts as not told.
     */
    const pokemonLanguageOf = async (
      imageId: number | null,
      bands: OcrBand[]
    ): Promise<PokemonTextLanguage> => {
      if (l.pokemonLanguage.imageId !== imageId)
        l.pokemonLanguage = { imageId, reads: 0, read: null }
      const known = l.pokemonLanguage
      if (known.read || known.reads >= LANGUAGE_MAX_READS || !bands.length) return known.read
      known.reads++
      const read = (model: TextModel): Promise<string[]> =>
        within(api.scan.readText(bands, model), LANGUAGE_TIMEOUT_MS)
      try {
        const [jpn, eng] = await Promise.all([read('jpn'), read('eng')])
        known.read = pokemonLanguageOfBands({ jpn, eng })
      } catch {
        known.read = null
      }
      return known.read
    }

    /**
     * A Pokémon card's name band read with the Japanese model, for its printed name when its text
     * can't be told: on LANGUAGE_MAX_READS frames at most while the same artwork stays in view,
     * every read so far given, since any one may show the name. A failed read is nothing read.
     */
    const pokemonNamesOf = async (imageId: number | null, bands: OcrBand[]): Promise<string[]> => {
      if (l.pokemonNames.imageId !== imageId) l.pokemonNames = { imageId, reads: [] }
      const known = l.pokemonNames
      if (known.reads.length < LANGUAGE_MAX_READS && bands.length)
        known.reads.push(
          await within(api.scan.readText(bands, 'jpn'), LANGUAGE_TIMEOUT_MS).catch(() => [])
        )
      return known.reads.flat()
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
      const profile = scanProfile(o.game)
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
          raw = await engine.analyze(frame, {
            candidates,
            wantText: l.lastFound,
            wantLook: !!o.lookModel && profile.rarityLook
          })
        } catch {
          // An engine thrown away for another game owes nothing.
          if (live && engineRef.current === engine) fail()
          return
        }
        // Another game's engine took over mid-frame: this frame is the old game's.
        if (!live || engineRef.current !== engine) return
        l.lastFound = raw.found
        // A card that left the view takes its language with it.
        if (!raw.found) {
          l.pokemonLanguage = { imageId: null, reads: 0, read: null }
          l.pokemonNames = { imageId: null, reads: [] }
        }
        let outcome: ScanOutcome
        try {
          outcome = await within(
            resolveSignals(raw, {
              game: o.game,
              setName: o.setName,
              setPrintings,
              defaultRarity: o.defaultRarity,
              cardLanguage: (cardId) => languageOf(cardId, raw.textBands),
              readLanguage: () => pokemonLanguageOf(raw.art[0]?.imageId ?? null, raw.textBands),
              readLocalName: () => pokemonNamesOf(raw.art[0]?.imageId ?? null, raw.nameBands ?? []),
              lookups: api.scan
            }),
            LOOKUP_TIMEOUT_MS
          )
        } catch {
          // An engine thrown away for another game owes nothing.
          if (live && engineRef.current === engine) fail({ reinit: false })
          return
        }
        l.failures = 0
        // The set or game changed mid-frame: this frame belongs to the old one.
        if (!live || latest.current.setKey !== o.setKey || engineRef.current !== engine) return
        // Something card-shaped that is no card gets no outline either.
        setOutline(
          raw.found && raw.quad && outcome.kind !== 'none'
            ? { quad: raw.quad, width, height }
            : null
        )
        // Only Yu-Gi-Oh's rarities are read by the look of the card.
        const looked = profile.rarityLook ? withLook(outcome, raw.cues, raw.look) : outcome
        const draft = tracker.current.push(performance.now(), looked)
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
