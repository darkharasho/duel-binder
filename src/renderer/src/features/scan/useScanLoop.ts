import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { GameId } from '@shared/games/types'
import type { LookModel } from '@shared/scan/look'
import { cuesOver, type RarityCues } from '@shared/scan/rarity'
import type { CardLanguage } from '@shared/scan/language'
import { tellPokemonLanguage, type PokemonTextLanguage } from '@shared/scan/pokemonLanguage'
import { scanProfile } from '@shared/scan/profiles'
import {
  ABSENT_MS,
  LANGUAGE_MAX_READS,
  LANGUAGE_RETRY_FRAMES,
  PHOTO_FRAMES,
  PHOTO_GAP_MS,
  PKM_PHOTO_REPRINT_LEAD,
  RARITY_MAX_READINGS
} from '@shared/scan/thresholds'
import type { FingerprintStatus, OcrBand, ScanPrinting } from '@shared/scan/types'
import type { PokemonLanguage, ScanStatus } from '@shared/scanWindow'
import { api } from '@/lib/api'
import { centreCrop } from './crop'
import type { EngineFactory, FrameSignals, ScanEngine } from './engine'
import {
  describeLook,
  resolveSignals,
  withRarityByLook,
  type ScanDraft,
  type ScanOutcome
} from './resolve'
import { sameSpot } from './sameSpot'
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
/** How often a running fingerprint download is asked how far along it is. */
const ART_PROGRESS_MS = 400
/** How often a game with no fingerprint file looks for one while scanning. */
const ART_RECHECK_MS = 60_000
const LOOKUP_TIMEOUT_MS = 30_000
const LANGUAGE_TIMEOUT_MS = 20_000
/**
 * A shown camera whose picture hasn't moved for this long is taken as frozen (a stream the
 * system muted in the background, or one that died without ending) and handed to onStalled.
 */
const STALL_MS = 5000
/** How long a failed photo's message stays once nothing's in view. */
const PHOTO_FAILED_MS = 4000

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
   * Pokémon only: the language live frames take every card to be in, so its art alone is searched
   * and no frame waits on reading its language. A photo still reads it, this being its fallback.
   */
  language?: PokemonLanguage | null
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
  /** Looks hard at what's in view for a few seconds, and counts the card it names. */
  takePhoto: () => void
  /** The card's outline in the scanned crop's pixels, and the crop's size, for drawing over the preview. */
  outline: { quad: Quad; width: number; height: number } | null
  /** null until the engine has been given the fingerprint file (or found there is none). */
  artReady: boolean | null
  /** Where the fingerprint file stands, once checked. */
  artData: FingerprintStatus | null
}

const sameStatus = (a: ScanStatus, b: ScanStatus): boolean =>
  a.kind === b.kind &&
  (a.kind !== 'added' ||
    (b.kind === 'added' && a.name === b.name && a.setCode === b.setCode && a.guess === b.guess))

/**
 * The part of the video's current frame the preview shows (its centre crop), at full camera
 * resolution, as a bitmap for the engine to hand to its worker: the pixels are never copied on
 * the UI thread.
 */
/** Dev builds of the app, not their tests, keep frames for replaying a live failure. */
const KEEP_FRAMES = import.meta.env.DEV && import.meta.env.MODE !== 'test'

/** Every DEBUG_EVERY-th frame is kept in a dev build: encoding a 4K frame isn't free. */
const DEBUG_EVERY = 3

/** What's known of a Pokémon card's language before any read of it. */
const NO_POKEMON_LANGUAGE = {
  quad: null as Quad | null,
  reads: 0,
  // Frames since the last read, once they're down to LANGUAGE_RETRY_FRAMES apart.
  since: 0,
  read: null as PokemonTextLanguage
}

const NO_POKEMON_NAMES = { quad: null as Quad | null, reads: [] as string[][] }

/** One frame's ms in the worker and in resolving it, with what it came to, for timing a scan. */
type FrameTime = [
  analyzeMs: number,
  resolveMs: number,
  outcome: ScanOutcome['kind'],
  counted: boolean
]

/** The frame as a JPEG, drawn before the engine takes it; null on the frames skipped. */
function debugShot(
  frame: ImageBitmap,
  width: number,
  height: number,
  l: { debugFrames: number }
): Promise<Blob> | null {
  if (l.debugFrames++ % DEBUG_EVERY !== 0) return null
  const canvas = new OffscreenCanvas(width, height)
  canvas.getContext('2d')?.drawImage(frame, 0, 0)
  return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.92 })
}

/** Hands the JPEG to main with what the scanner made of it. */
async function keepDebugShot(
  shot: Promise<Blob>,
  game: GameId,
  raw: FrameSignals,
  outcome: ScanOutcome,
  counted: boolean,
  times: FrameTime[]
): Promise<void> {
  const jpeg = await (await shot).arrayBuffer()
  const note = JSON.stringify({
    game,
    found: raw.found,
    quad: raw.quad,
    via: raw.artVia ?? null,
    top: raw.art.slice(0, 3).map((a) => [a.imageId, a.distance]),
    outcome: outcome.kind,
    far: outcome.kind === 'none' ? (outcome.far ?? false) : undefined,
    card: outcome.kind === 'recognized' ? outcome.item.cardId : undefined,
    guess: outcome.kind === 'recognized' ? (outcome.item.guess ?? false) : undefined,
    counted,
    times
  })
  await api.scan.debugFrame(jpeg, note).catch(() => undefined)
}

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
  const [artData, setArtData] = useState<FingerprintStatus | null>(null)

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
    debugFrames: 0,
    debugTimes: [] as FrameTime[],
    retryAt: 0,
    stopped: false,
    photoWanted: false,
    photoFailedUntil: 0,
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
    // The same for a Pokémon card, by where it is in the frame: its card isn't known yet, and the
    // artwork it matches best changes frame to frame on a card that's hard to see.
    pokemonLanguage: { ...NO_POKEMON_LANGUAGE },
    // A Pokémon card's name band as the Japanese model reads it, every read so far, likewise.
    pokemonNames: { ...NO_POKEMON_NAMES, reads: [] as string[][] },
    status: { kind: 'idle' } as ScanStatus
  })

  /** Live frames search only the language's art; on trouble, all of it, which is just slower. */
  const narrow = async (engine: ScanEngine): Promise<void> => {
    const { language } = latest.current
    const ids = language
      ? await within(
          Promise.resolve().then(() => api.scan.imagesForLanguage(language)),
          LOOKUP_TIMEOUT_MS
        ).catch(() => null)
      : null
    if (engineRef.current === engine) engine.scope(ids?.length ? ids : null)
  }

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
      // Extras: without them (an older portal, a phone build without them, Pokémon, which has no
      // printing scans) art matches as before.
      const refs =
        fp && game === 'ygo'
          ? await within(
              Promise.resolve().then(() => api.scan.fingerprintRefs()),
              FINGERPRINTS_TIMEOUT_MS
            ).catch(() => [])
          : []
      if (!live) return
      setArtReady(fp !== null)
      await engine.init(fp, refs)
      await narrow(engine)
    }
    reinit.current = init
    let progressTimer: ReturnType<typeof setInterval> | undefined
    let recheckTimer: ReturnType<typeof setTimeout> | undefined
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
      // A newer file, once downloaded, goes to the engine between frames. With none yet, keep
      // looking: the first one can be published while the scanner is open.
      const refresh = async (): Promise<void> => {
        progressTimer = setInterval(() => {
          api.scan.fingerprintStatus(game).then(
            (s) => {
              if (live) setArtData(s)
            },
            () => {
              // Unreadable: the notice stays as it was.
            }
          )
        }, ART_PROGRESS_MS)
        const refreshed = await api.scan.refreshFingerprints(game).catch(() => null)
        clearInterval(progressTimer)
        if (!live) return
        setArtData(refreshed)
        if (refreshed?.updated) loop.current.needsInit = true
        if (refreshed?.state !== 'ready') recheckTimer = setTimeout(refresh, ART_RECHECK_MS)
      }
      await refresh()
    })()
    return () => {
      live = false
      clearInterval(progressTimer)
      clearTimeout(recheckTimer)
      readyRef.current = false
      reinit.current = null
      engineRef.current = null
      showings.reset()
      engine.dispose()
      setOutline(null)
    }
  }, [game])

  // Another language's art to search; the engine's init does it for the first.
  const { language } = opts
  useEffect(() => {
    const engine = engineRef.current
    if (engine && readyRef.current) void narrow(engine)
  }, [language])

  // A new set, game or language is a new start: nothing counted yet, nothing in view.
  useEffect(() => {
    const l = loop.current
    tracker.current.reset()
    l.lastFound = false
    l.shown = null
    l.absentSince = null
    l.looks = { cardId: null, cues: [], frames: [] }
    l.language = { cardId: null, reads: 0, read: null }
    l.pokemonLanguage = { ...NO_POKEMON_LANGUAGE }
    l.pokemonNames = { ...NO_POKEMON_NAMES, reads: [] }
    // Stopped stays stopped until Retry.
    if (l.stopped) return
    l.status = { kind: 'idle' }
    setStatusState(l.status)
  }, [opts.setKey, game, language])

  const takePhoto = useCallback(() => {
    if (!latest.current.running || loop.current.stopped) return
    loop.current.photoWanted = true
    setStatus({ kind: 'reading' })
    // setStatus only touches refs and state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
          // Time to read that a photo failed, with the card already lowered.
          if (now >= l.photoFailedUntil) setStatus({ kind: 'idle' })
        }
        return
      }
      l.absentSince = null
      if (draft) {
        l.shown = draft.cardId
        setStatus({
          kind: 'added',
          name: draft.name,
          setCode: draft.setCode,
          ...(draft.guess ? { guess: true as const } : {})
        })
      } else if (
        outcome.kind === 'unsure' &&
        l.shown === null &&
        performance.now() >= l.photoFailedUntil
      ) {
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
     * A Pokémon card's language (tellPokemonLanguage). Kept, like languageOf, while the card stays
     * where it is, and tried on LANGUAGE_MAX_READS frames when it can't be told, then on every
     * LANGUAGE_RETRY_FRAMES'th: a card held still may yet turn to where it can be read. A failed
     * read counts as not told.
     */
    const pokemonLanguageOf = async (
      quad: Quad | null,
      bands: OcrBand[]
    ): Promise<PokemonTextLanguage> => {
      if (!sameSpot(l.pokemonLanguage.quad, quad))
        l.pokemonLanguage = { ...NO_POKEMON_LANGUAGE }
      const known = l.pokemonLanguage
      known.quad = quad
      if (known.read || !bands.length) return known.read
      const spare = known.reads >= LANGUAGE_MAX_READS
      if (spare && ++known.since < LANGUAGE_RETRY_FRAMES) return null
      known.since = 0
      known.reads++
      try {
        known.read = await tellPokemonLanguage(bands, (b, model) =>
          within(api.scan.readText(b, model), LANGUAGE_TIMEOUT_MS)
        )
      } catch {
        known.read = null
      }
      return known.read
    }

    /**
     * A Pokémon card's name band read with the Japanese model, for its printed name when its text
     * can't be told: on LANGUAGE_MAX_READS frames at most while the card stays where it is,
     * every read so far given, since any one may show the name. A failed read is nothing read.
     */
    const pokemonNamesOf = async (quad: Quad | null, bands: OcrBand[]): Promise<string[]> => {
      if (!sameSpot(l.pokemonNames.quad, quad)) l.pokemonNames = { ...NO_POKEMON_NAMES, reads: [] }
      const known = l.pokemonNames
      known.quad = quad
      if (known.reads.length < LANGUAGE_MAX_READS && bands.length)
        known.reads.push(
          await within(api.scan.readText(bands, 'jpn'), LANGUAGE_TIMEOUT_MS).catch(() => [])
        )
      return known.reads.flat()
    }

    /**
     * A photo of what's in view: up to PHOTO_FRAMES frames, each given every language's art, the
     * whole holder search and a fresh read of its text, until one names a card for certain, else
     * the first guess. The same outcome the live frames work towards, so a card can be counted
     * from one look; the live scan then leaves it be (ShowingTracker.settle).
     */
    const photo = async (
      engine: ScanEngine,
      video: HTMLVideoElement,
      o: typeof latest.current
    ): Promise<void> => {
      const stale = (): boolean =>
        !live || latest.current.setKey !== o.setKey || engineRef.current !== engine
      const profile = scanProfile(o.game)
      setOutline(null)
      let best: ScanOutcome | null = null
      for (let i = 0; i < PHOTO_FRAMES && !stale(); i++) {
        if (i) await new Promise((done) => setTimeout(done, PHOTO_GAP_MS))
        const grabbed = await grab(video).catch(() => null)
        if (!grabbed) continue
        const raw = await engine
          .analyze(grabbed.frame, {
            candidates: o.candidates,
            wantText: true,
            wantLook: !!o.lookModel && profile.rarityLook,
            photo: true
          })
          .catch(() => null)
        if (!raw || stale()) continue
        const outcome = await within(
          resolveSignals(raw, {
            game: o.game,
            reprintLead: PKM_PHOTO_REPRINT_LEAD,
            setName: o.setName,
            setPrintings: o.setPrintings ?? null,
            defaultRarity: o.defaultRarity,
            cardLanguage: (cardId) => languageOf(cardId, raw.textBands),
            readLanguage: () =>
              tellPokemonLanguage(raw.textBands, (b, model) =>
                within(api.scan.readText(b, model), LANGUAGE_TIMEOUT_MS)
              )
                .catch(() => null)
                .then((read) => read ?? o.language ?? null),
            readLocalName: async () => {
              const reads = api.scan.readText(raw.nameBands ?? [], 'jpn')
              return within(reads, LANGUAGE_TIMEOUT_MS).catch(() => [] as string[])
            },
            lookups: api.scan
          }),
          LOOKUP_TIMEOUT_MS
        ).catch(() => null)
        if (outcome?.kind !== 'recognized' || stale()) continue
        const looked = profile.rarityLook ? withLook(outcome, raw.cues, raw.look) : outcome
        if (looked.kind !== 'recognized') continue
        if (!looked.item.guess) {
          best = looked
          break
        }
        best ??= looked
      }
      if (stale()) return
      tracker.current.settle(performance.now())
      if (best?.kind === 'recognized') {
        show(best, best.item)
        latest.current.onDraft(best.item)
      } else {
        l.photoFailedUntil = performance.now() + PHOTO_FAILED_MS
        setStatus({ kind: 'photo-failed' })
      }
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
        if (l.photoWanted) {
          l.photoWanted = false
          await photo(engine, video, o)
          return
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
        const shot = KEEP_FRAMES ? debugShot(frame, width, height, l) : null
        const started = performance.now()
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
        const analyzed = performance.now()
        // A card that left the view takes its language with it.
        if (!raw.found) {
          l.pokemonLanguage = { ...NO_POKEMON_LANGUAGE }
          l.pokemonNames = { ...NO_POKEMON_NAMES, reads: [] }
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
              readLanguage: o.language
                ? async () => o.language ?? null
                : () => pokemonLanguageOf(raw.quad, raw.textBands),
              readLocalName: () => pokemonNamesOf(raw.quad, raw.nameBands ?? []),
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
        if (KEEP_FRAMES) {
          l.debugTimes.push([
            Math.round(analyzed - started),
            Math.round(performance.now() - analyzed),
            outcome.kind,
            draft !== null
          ])
        }
        if (shot) {
          void keepDebugShot(shot, o.game, raw, outcome, draft !== null, l.debugTimes)
          l.debugTimes = []
        }
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

  return { status, retry, takePhoto, outline, artReady, artData }
}
