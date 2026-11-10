import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  CameraIcon,
  CheckIcon,
  LoaderIcon,
  ScanLineIcon,
  ScanTextIcon,
  Trash2Icon,
  XIcon
} from 'lucide-react'
import { defaultEngine, type EngineFactory } from '@/features/scan/engine'
import { useScanHub } from '@/features/scan/ScanHub'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { useCamera } from '@/features/scan/useCamera'
import { api } from '@/lib/api'
import { cardImageSrc } from '@/lib/images'
import { cn } from '@/lib/utils'
import type { GameId } from '@shared/games'
import { normalizeOpNumber, prefixSuggestions } from '@shared/scan/onePieceNumber'
import {
  HOLDER_LABELS,
  TRAINING_HOLDERS,
  type TrainingHolder,
  type TrainingLabel,
  type TrainingSummary
} from '@shared/training'
import { CAMERA_MESSAGES } from '../copy'
import { PhoneContext } from '../context'
import { appVersion, deviceModel, grabShot, newClientId, type Grabbed } from './capture'
import {
  CAP_REACHED,
  CONTRIBUTE_TITLE,
  DESKTOP_KEYS_HINT,
  DROPPED,
  GRAB_FAILED,
  NOT_SYNCED,
  NO_VERSIONS,
  NUMBER_LABEL,
  NUMBER_PLACEHOLDER,
  OFFLINE_WAIT,
  READ_LABEL,
  SAVED,
  SNAP_BUTTON,
  SNAP_HINT,
  SNAP_MANY,
  SNAP_NONE,
  SNAP_READING,
  VERSION_KEYS_HINT,
  WHAT_TO_SHOOT,
  WHAT_TO_SHOOT_TITLE,
  photoCount,
  shotsOf
} from './copy'
import { useNumberReader } from './numberReader'
import {
  PHONE_SNAP_GROW,
  SNAP_BOX,
  createSharpnessGate,
  createVote,
  grabSnap,
  readSnap,
  sharpness,
  type SnapResult
} from './numberSnap'
import { trainingOutbox, type DrainResult, type Outbox, type Sender } from './outbox'

/**
 * What the screen needs from the app it runs in: the account the photos are for, and the calls
 * that send them. The phone's come from its store; the desktop passes its own (window.api.training).
 */
export interface TrainingDeps extends Sender {
  userId: number
  /** This account's photo counts for the game; null signed out, offline or refused. */
  summary(game: GameId): Promise<TrainingSummary | null>
  /** `[local printing id, server id]` for those of these printings the server knows. */
  serverIds(printingIds: number[]): Promise<[number, number][]>
}

/** The phone's TrainingDeps, from its session. */
function usePhoneDeps(given: TrainingDeps | undefined): TrainingDeps {
  const phone = useContext(PhoneContext)
  const store = phone?.store
  const userId = phone?.user.id
  return useMemo(() => {
    if (given) return given
    if (!store || userId === undefined)
      throw new Error('ContributeScreen needs deps or a PhoneContext')
    return {
      userId,
      upload: (id, label, jpeg) => store.trainingUpload(id, label, jpeg),
      remove: (id) => store.trainingDelete(id),
      summary: (game) => store.trainingSummary(game),
      serverIds: (ids) => store.printingPhotoIds(ids)
    }
  }, [given, store, userId])
}

/** The phone's read timing, for admins: totals since the screen opened. */
interface ReadTiming {
  /** The last number's time to fill in, from its card's start. */
  fillMs: number | null
  reads: number
  readMs: number
  blurry: number
}
const NO_TIMING: ReadTiming = { fillMs: null, reads: 0, readMs: 0, blurry: 0 }

/** "filled in 1.4 s · read 320 ms avg (12) · 3 blurry skipped" */
function timingText(t: ReadTiming): string {
  const parts = [
    t.fillMs === null ? 'filled in –' : `filled in ${(t.fillMs / 1000).toFixed(1)} s`,
    t.reads === 0 ? 'read –' : `read ${Math.round(t.readMs / t.reads)} ms avg (${t.reads})`,
    `${t.blurry} blurry skipped`
  ]
  return parts.join(' · ')
}

const HOLDER_KEY = 'training.holder'
const DRAIN_EVERY_MS = 30_000
const SAVED_MS = 1200
/** How long the shutter's flourish (flash, the shot flying to the tray) runs. */
const FLOURISH_MS = 650
/** How long Read number's problem stays up. */
const SNAP_PROBLEM_MS = 3000
/** The phone's pause between reads of the guide box. */
const AUTO_SNAP_PAUSE_MS = 150
/** The phone's pause after a frame skipped as blurred: the next one comes soon. */
const AUTO_SNAP_BLURRY_PAUSE_MS = 30
/** A number fills in once it is `NEED` of the last `OF` guide-box reads. */
const AUTO_SNAP_NEED = 2
const AUTO_SNAP_OF = 3
/** Guide-box reads in a row with nothing before the card just done may be read again. */
const AUTO_SNAP_SKIP_CLEARS_AFTER = 3
/** Shots still encoding at once; past this the shutter waits, so 4K frames don't pile up. */
const MAX_PENDING_SHOTS = 2

function storedHolder(): TrainingHolder {
  try {
    const v = localStorage.getItem(HOLDER_KEY)
    if (v && (TRAINING_HOLDERS as readonly string[]).includes(v)) return v as TrainingHolder
  } catch {
    // No storage: the default.
  }
  return 'bare'
}

/** One version of the typed number, as a tile. */
interface Version {
  cardId: number
  printingId: number
  label: string
  setName: string
  imageId: number
}

/** The versions (printings) whose set code is `number`, from the phone's own catalog. */
async function versionsOf(number: string): Promise<Version[]> {
  const found = await api.scan.printingsByCode(number)
  const cardIds = [...new Set(found.map((p) => p.cardId))]
  const details = await Promise.all(cardIds.map((id) => api.cards.get(id)))
  const out: Version[] = []
  for (const d of details) {
    if (!d) continue
    const art = d.images[0]?.imageId
    for (const p of d.printings) {
      if (p.setCode !== number) continue
      const imageId = p.artImageId ?? art
      if (imageId === undefined) continue
      out.push({
        cardId: d.card.id,
        printingId: p.id,
        label: p.setRarity,
        setName: p.setName,
        imageId
      })
    }
  }
  return out
}

type Selected = Version & { serverId: number | null | undefined }

/** A shot taken on this screen: its outbox id, its version, and its picture for the tray. */
interface Shot {
  id: string
  printingId: number
  url: string | null
}

/** A shot's JPEG as a picture URL; null where the browser can't make one. */
function pictureUrl(jpeg: ArrayBuffer): string | null {
  if (typeof URL.createObjectURL !== 'function') return null
  try {
    return URL.createObjectURL(new Blob([jpeg], { type: 'image/jpeg' }))
  } catch {
    return null
  }
}

const panel = 'rounded-2xl border border-white/[0.08] bg-black/45 backdrop-blur-md'

/** Whether the catalog has a card with this number. */
const numberExists = async (number: string): Promise<boolean> =>
  (await api.scan.printingsByCode(number)).length > 0

/** A webcam's usual shape, until the camera says its own. */
const DESKTOP_DEFAULT_ASPECT = 16 / 9
/** A camera listed before permission has no id; its item opens the default camera. */
const UNNAMED_CAMERA = 'unnamed-camera-'

/**
 * Testers' training photos: type a card's number (or, for One Piece, take the one the camera
 * read), pick the version in hand and its holder, then shoot. On the phone a One Piece number the
 * camera reads fills itself in, and reading goes on after it: the next card held up replaces it,
 * so a run of cards needs only the shutter (and a version tap where a number has several). Each shot goes to the outbox with
 * its own label and uploads from there (also after this screen closes, through the shell's drain).
 */
export function ContributeScreen({
  game,
  onClose,
  outbox: given,
  grab = grabShot,
  now = () => new Date(),
  engineFactory = defaultEngine,
  readPauseMs,
  snap: givenSnap,
  deps: givenDeps,
  layout = 'phone'
}: {
  game: GameId
  onClose(): void
  /** Tests. Default `trainingOutbox()`. */ outbox?: Outbox
  /** Tests. A shot: its JPEG, or a tray picture now and the JPEG later. */
  grab?: (video: HTMLVideoElement) => Promise<ArrayBuffer> | Grabbed
  /** Tests. */ now?: () => Date
  /** Tests. The number reader's engine. */ engineFactory?: EngineFactory
  /** Tests. The number reader's pause between tries. */ readPauseMs?: number
  /** Tests. Read number: the number held in the preview's guide box. */
  snap?: (video: HTMLVideoElement) => Promise<SnapResult>
  /** The app's calls; the phone's store when left out. */
  deps?: TrainingDeps
  /** 'desktop': camera beside the controls, and keys for every step. */
  layout?: 'phone' | 'desktop'
}): React.JSX.Element {
  const desktop = layout === 'desktop'
  const deps = usePhoneDeps(givenDeps)
  const phone = useContext(PhoneContext)
  const userId = deps.userId
  const outbox = useMemo(() => given ?? trainingOutbox(), [given])
  const { settings, setSettings } = useScanHub()
  // The desktop asks for no facing (like its scanner); the camera picked on Scan is used.
  const camera = useCamera(settings.deviceId, desktop ? undefined : 'environment')
  const videoRef = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    video.srcObject = camera.stream
    if (camera.stream) void video.play?.()?.catch(() => undefined)
  }, [camera.stream])

  // The desktop's preview takes the camera's own shape (a webcam is landscape), as large as fits,
  // so it shows the whole frame a photo keeps and the guide box sits where the reader looks.
  const [videoAspect, setVideoAspect] = useState(DESKTOP_DEFAULT_ASPECT)
  useEffect(() => {
    const video = videoRef.current
    if (!desktop || !video) return
    const read = (): void => {
      if (video.videoWidth && video.videoHeight)
        setVideoAspect(video.videoWidth / video.videoHeight)
    }
    read()
    video.addEventListener('loadedmetadata', read)
    video.addEventListener('resize', read)
    return () => {
      video.removeEventListener('loadedmetadata', read)
      video.removeEventListener('resize', read)
    }
  }, [desktop, camera.stream])
  const stageRef = useRef<HTMLDivElement>(null)
  const [stage, setStage] = useState<{ width: number; height: number } | null>(null)
  useEffect(() => {
    const el = stageRef.current
    if (!desktop || !el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setStage({ width, height })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [desktop])
  const boxSize =
    stage && stage.width > 0 && stage.height > 0
      ? stage.width / stage.height > videoAspect
        ? { width: Math.round(stage.height * videoAspect), height: Math.round(stage.height) }
        : { width: Math.round(stage.width), height: Math.round(stage.width / videoAspect) }
      : null

  // The open camera, shown as picked only when it's listed (ids are blank before permission) and
  // not in error, so picking it again reopens it.
  const openCamera = camera.stream?.getVideoTracks()[0]?.getSettings().deviceId ?? ''
  const activeCamera =
    !camera.error && camera.devices.some((d) => d.deviceId === openCamera) ? openCamera : ''
  const pickCamera = (id: string): void => {
    const deviceId = id.startsWith(UNNAMED_CAMERA) ? null : id
    // A different camera opens from the settings change; re-picking the current one retries it.
    if (deviceId === settings.deviceId) camera.retry()
    else setSettings({ deviceId })
  }

  const [text, setText] = useState('')
  const number = normalizeOpNumber(text)
  const prefixes = useQuery({
    queryKey: ['training', 'numberPrefixes'],
    queryFn: () => api.scan.numberPrefixes()
  })
  const chips = prefixSuggestions(text, prefixes.data ?? [])

  // One Piece numbers read off the camera while nothing is typed: offered for one tap on the
  // desktop, filled in on the phone. On the phone reading goes on while the number is one it read
  // (not typed), so the next card replaces it. The card just done (Next card) isn't read again
  // while it's still in front of the camera.
  const [done, setDone] = useState<string | null>(null)
  const [autoFilled, setAutoFilled] = useState(false)
  const [resetKey, setResetKey] = useState(0)
  const reading =
    game === 'op' && camera.stream !== null && (text === '' || (!desktop && autoFilled))
  // The whole-frame reader runs on the desktop only: on the phone the guide box's reader (below)
  // gets the CPU and the OCR queue to itself.
  const read = useNumberReader({
    video: videoRef,
    active: desktop && reading,
    game,
    engineFactory,
    prefixes: prefixes.data,
    exists: numberExists,
    skip: done,
    resetKey,
    pauseMs: readPauseMs
  })
  const versions = useQuery({
    queryKey: ['training', 'versions', number],
    queryFn: () => versionsOf(number!),
    enabled: number !== null
  })

  // ---- Read number: a tap reads the number held up close in the guide box ----
  const [snapping, setSnapping] = useState(false)
  const [snapProblem, setSnapProblem] = useState<'none' | 'many' | null>(null)
  const [filled, setFilled] = useState(0)
  useEffect(() => {
    if (!snapProblem) return
    const t = setTimeout(() => setSnapProblem(null), SNAP_PROBLEM_MS)
    return () => clearTimeout(t)
  }, [snapProblem])
  // The phone reads a box larger than the one drawn, so a wobbling hand keeps the number in it,
  // and skips frames blurred next to the last few before their OCR.
  const sharpGate = useRef<ReturnType<typeof createSharpnessGate> | null>(null)
  sharpGate.current ??= createSharpnessGate()
  const snap =
    givenSnap ??
    (async (video: HTMLVideoElement): Promise<SnapResult> => {
      const grow = desktop ? 1 : PHONE_SNAP_GROW
      const band = grabSnap(video, grow)
      if (!band) return { problem: 'none' }
      if (!desktop && !sharpGate.current?.pass(sharpness(band))) return { problem: 'blurry' }
      return readSnap(band, {
        ocr: (bands) => api.scan.ocr(bands, 'code'),
        prefixes: prefixes.data,
        exists: numberExists,
        grow
      })
    })
  const canSnap = game === 'op' && camera.stream !== null && !snapping

  // ---- The phone reads the number by itself: the camera's reads fill it in ----
  const fillRead = (n: string): void => {
    setText(n)
    setSelected(null)
    setAutoFilled(true)
    setFilled((c) => c + 1)
    navigator.vibrate?.(15)
  }
  const fillRef = useRef(fillRead)
  fillRef.current = fillRead
  const snapRef = useRef(snap)
  snapRef.current = snap
  const numberRef = useRef(number)
  numberRef.current = number
  const doneRef = useRef(done)
  doneRef.current = done
  // How fast the phone reads, for admins to report: from a new card (reading starting, Next card,
  // or the last number filled) to its number filling in, and a read's average time.
  const showTiming = !desktop && phone?.user.admin === true
  const showTimingRef = useRef(showTiming)
  showTimingRef.current = showTiming
  const [timing, setTiming] = useState<ReadTiming>(NO_TIMING)
  // The guide box, read over and over: a number two of the last three reads agree on that isn't
  // the one shown (nor the card just done) fills in. Blurred frames are skipped, not counted.
  const autoSnap = !desktop && reading
  useEffect(() => {
    if (!autoSnap) return
    let on = true
    let skip = doneRef.current
    const vote = createVote(AUTO_SNAP_NEED, AUTO_SNAP_OF)
    sharpGate.current?.reset()
    let empty = 0
    let since = performance.now()
    const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
    void (async () => {
      while (on) {
        const video = videoRef.current
        let got: string | null = null
        let blurry = false
        const started = performance.now()
        if (video && !document.hidden) {
          try {
            const r = await snapRef.current(video)
            if ('number' in r) got = r.number
            else blurry = r.problem === 'blurry'
          } catch {
            // Quiet: the next try, or typing.
          }
        }
        if (!on) return
        const took = performance.now() - started
        if (showTimingRef.current)
          setTiming((t) =>
            blurry
              ? { ...t, blurry: t.blurry + 1 }
              : { ...t, reads: t.reads + 1, readMs: t.readMs + took }
          )
        if (blurry) {
          await sleep(readPauseMs ?? AUTO_SNAP_BLURRY_PAUSE_MS)
          continue
        }
        empty = got === null ? empty + 1 : 0
        if (skip && ((got !== null && got !== skip) || empty >= AUTO_SNAP_SKIP_CLEARS_AFTER))
          skip = null
        if (got === skip) got = null
        const agreed = vote.push(got)
        if (agreed !== null && agreed !== numberRef.current) {
          fillRef.current(agreed)
          const now = performance.now()
          if (showTimingRef.current) setTiming((t) => ({ ...t, fillMs: now - since }))
          since = now
        }
        await sleep(readPauseMs ?? AUTO_SNAP_PAUSE_MS)
      }
    })()
    return () => {
      on = false
    }
  }, [autoSnap, resetKey, readPauseMs])
  const readNumber = async (): Promise<void> => {
    const video = videoRef.current
    if (!video) return
    setSnapping(true)
    setSnapProblem(null)
    try {
      const r = await snap(video)
      if (!live.current) return
      if ('number' in r) {
        setText(r.number)
        setSelected(null)
        setFilled((n) => n + 1)
        navigator.vibrate?.(15)
      } else setSnapProblem(r.problem === 'many' ? 'many' : 'none')
    } catch {
      if (live.current) setSnapProblem('none')
    } finally {
      if (live.current) setSnapping(false)
    }
  }

  const [selected, setSelected] = useState<Selected | null>(null)
  const choose = (v: Version): void => {
    setSelected({ ...v, serverId: undefined })
    void deps
      .serverIds([v.printingId])
      .catch(() => [] as [number, number][])
      .then((pairs) => {
        const serverId = pairs.find(([id]) => id === v.printingId)?.[1] ?? null
        setSelected((s) => (s && s.printingId === v.printingId ? { ...s, serverId } : s))
      })
  }

  const [holder, setHolderState] = useState<TrainingHolder>(storedHolder)
  const setHolder = (h: TrainingHolder): void => {
    setHolderState(h)
    try {
      localStorage.setItem(HOLDER_KEY, h)
    } catch {
      // Not kept; this session still uses it.
    }
  }

  // ---- Counts and the outbox ----
  const [summary, setSummary] = useState<TrainingSummary | null>(null)
  const [waiting, setWaiting] = useState(0)
  const [stopped, setStopped] = useState<DrainResult['stopped']>(null)
  const [dropped, setDropped] = useState(false)
  const live = useRef(true)
  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
    }
  }, [])

  const readSummary = useCallback(async (): Promise<void> => {
    const s = await deps.summary(game).catch(() => null)
    // Offline or refused: the last known numbers stay.
    if (s && live.current) setSummary(s)
  }, [deps, game])
  const readWaiting = useCallback(async (): Promise<void> => {
    const n = await outbox.waiting(userId).catch(() => 0)
    if (live.current) setWaiting(n)
  }, [outbox, userId])

  const drain = useCallback(async (): Promise<void> => {
    let r: DrainResult
    try {
      r = await outbox.drain(userId, deps)
    } catch {
      return
    }
    if (!live.current) return
    setStopped(r.stopped)
    if (r.dropped.length > 0) setDropped(true)
    void readSummary()
    void readWaiting()
  }, [outbox, userId, deps, readSummary, readWaiting])

  useEffect(() => {
    void readSummary()
    void readWaiting()
    return outbox.onChange(() => void readWaiting())
  }, [outbox, readSummary, readWaiting])

  // While anything waits, another try every 30 s; not past the daily cap, which won't lift soon.
  useEffect(() => {
    if (waiting === 0 || stopped === 'daily-cap') return
    const timer = setInterval(() => void drain(), DRAIN_EVERY_MS)
    return () => clearInterval(timer)
  }, [waiting, stopped, drain])

  // ---- Shots ----
  const [stack, setStack] = useState<Shot[]>([])
  // The shutter's flourish: a key per shot, so each one replays it, and the shot's picture.
  const [flourish, setFlourish] = useState<{ key: number; url: string | null } | null>(null)
  useEffect(() => {
    if (!flourish) return
    const t = setTimeout(() => setFlourish(null), FLOURISH_MS)
    return () => clearTimeout(t)
  }, [flourish])
  // Each shot's picture is freed when its shot is deleted, and all of them when the screen closes.
  const urls = useRef(new Set<string>())
  useEffect(() => {
    const all = urls.current
    return () => {
      for (const u of all) URL.revokeObjectURL(u)
      all.clear()
    }
  }, [])
  const [shotError, setShotError] = useState(false)
  const [saved, setSaved] = useState(0)
  useEffect(() => {
    if (!saved) return
    const t = setTimeout(() => setSaved(0), SAVED_MS)
    return () => clearTimeout(t)
  }, [saved])

  const serverId = selected?.serverId ?? null
  // Shots taken but still encoding or being stored, in order, so deletes and drains follow them.
  const work = useRef<Promise<void>>(Promise.resolve())
  const [pending, setPending] = useState(0)

  const shooting = pending >= MAX_PENDING_SHOTS
  const canShoot = serverId !== null && camera.stream !== null && !shooting

  const shoot = (): void => {
    const video = videoRef.current
    if (!selected || serverId === null || !video || pending >= MAX_PENDING_SHOTS) return
    const takenAt = now().toISOString()
    setShotError(false)
    let shot: Grabbed
    try {
      const g = grab(video)
      shot = g instanceof Promise ? { thumb: null, jpeg: g } : g
    } catch {
      setShotError(true)
      return
    }
    // The frame is taken: the shutter is free again while it encodes and is stored.
    const id = newClientId()
    const printingId = selected.printingId
    const base = { game, cardId: selected.cardId, printingId: serverId, holder, takenAt }
    setStack((s) => [...s, { id, printingId, url: shot.thumb }])
    setSaved((n) => n + 1)
    setFlourish((f) => ({ key: (f?.key ?? 0) + 1, url: shot.thumb }))
    navigator.vibrate?.(25)
    setPending((n) => n + 1)
    work.current = work.current
      .then(async () => {
        const jpeg = await shot.jpeg
        const label: TrainingLabel = {
          ...base,
          device: await deviceModel(),
          appVersion: appVersion()
        }
        // No picture yet (a grab that only gives the JPEG): this one, copied before the outbox
        // keeps the bytes.
        if (!shot.thumb) {
          const url = pictureUrl(jpeg)
          if (url) {
            urls.current.add(url)
            if (live.current) setStack((s) => s.map((x) => (x.id === id ? { ...x, url } : x)))
          }
        }
        await outbox.addUpload(userId, id, label, jpeg)
      })
      .catch(() => {
        if (!live.current) return
        setStack((s) => s.filter((x) => x.id !== id))
        setShotError(true)
      })
      .finally(() => {
        if (live.current) setPending((n) => n - 1)
        void drain()
      })
  }

  const deleteLast = async (): Promise<void> => {
    const last = stack[stack.length - 1]
    if (!last) return
    setStack((s) => s.slice(0, -1))
    if (last.url) {
      URL.revokeObjectURL(last.url)
      urls.current.delete(last.url)
    }
    // After the shot is stored, if it's still on its way there.
    const forgot = work.current.then(() => outbox.forget(userId, last.id).then(() => undefined))
    work.current = forgot.catch(() => undefined)
    await work.current
    void drain()
  }

  const numberInput = useRef<HTMLInputElement>(null)
  const nextCard = (): void => {
    setDone(number)
    setAutoFilled(false)
    setResetKey((k) => k + 1)
    setText('')
    setSelected(null)
    setShotError(false)
    if (desktop) numberInput.current?.focus()
  }

  // One version of the number: it's the one in hand, so it's picked without a tap.
  const only = versions.data?.length === 1 && number !== null ? versions.data[0] : null
  useEffect(() => {
    if (only && selected === null) choose(only)
    // choose is new each render; the version to pick is all that matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [only, selected])

  // The desktop's keys, so a run of cards never needs the mouse.
  const keys = useRef({ shoot, deleteLast, nextCard, readNumber, choose, setHolder, onClose })
  keys.current = { shoot, deleteLast, nextCard, readNumber, choose, setHolder, onClose }
  const state = useRef({ canShoot, canSnap, read, text, versions: versions.data, selected })
  state.current = { canShoot, canSnap, read, text, versions: versions.data, selected }
  useEffect(() => {
    if (!desktop) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return
      const k = keys.current
      const s = state.current
      const target = e.target as HTMLElement | null
      // The camera list keeps its own keys (Esc closes the list, not the screen); its closed
      // button keeps only Esc.
      if (target?.closest('[role="listbox"]')) return
      if (target?.closest('[role="combobox"]') && e.key !== 'Escape') return
      const typing = target?.tagName === 'INPUT'
      const inOtherControl =
        !typing && target !== null && target.closest('summary, details') !== null
      if (e.key === 'Escape') {
        e.preventDefault()
        k.onClose()
      } else if (e.key === ' ' && !inOtherControl) {
        // A card number has no spaces, so Space shoots even while the number box has focus.
        e.preventDefault()
        if (s.canShoot) k.shoot()
      } else if (e.key === 'Enter') {
        if (s.text === '' && s.read !== null) {
          e.preventDefault()
          setText(s.read)
          setSelected(null)
        } else if (s.canShoot) {
          e.preventDefault()
          k.shoot()
        }
      } else if (typing) {
        return
      } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && s.versions?.length) {
        e.preventDefault()
        const list = s.versions
        const at = list.findIndex((v) => v.printingId === s.selected?.printingId)
        const step = e.key === 'ArrowRight' ? 1 : -1
        const next = at === -1 ? (step === 1 ? 0 : list.length - 1) : at + step
        k.choose(list[(next + list.length) % list.length])
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault()
        void k.deleteLast()
      } else if (e.key === 'n' || e.key === 'N') {
        e.preventDefault()
        k.nextCard()
      } else if ((e.key === 'r' || e.key === 'R') && s.canSnap) {
        e.preventDefault()
        void k.readNumber()
      } else if (/^[1-5]$/.test(e.key)) {
        e.preventDefault()
        k.setHolder(TRAINING_HOLDERS[Number(e.key) - 1])
      } else if (/^[a-z0-9-]$/i.test(e.key)) {
        // Typing a number anywhere goes to the number box.
        numberInput.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [desktop])

  const count = photoCount(summary, waiting)
  const lastShot = stack[stack.length - 1] ?? null
  const shotsOfSelected = selected
    ? stack.filter((s) => s.printingId === selected.printingId).length
    : 0
  const guide = game === 'op' && text === '' && camera.stream !== null
  const kbd = (key: string): React.JSX.Element | null =>
    desktop ? (
      <kbd className="rounded border border-white/20 px-1 font-mono text-[11px] font-normal leading-4 text-muted-foreground">
        {key}
      </kbd>
    ) : null

  const closeButton = (
    <button
      type="button"
      aria-label="Close"
      onClick={onClose}
      className="flex size-11 items-center justify-center rounded-full bg-white/[0.06] hover:bg-white/[0.1] active:bg-white/[0.12]"
    >
      <XIcon aria-hidden className="size-5" />
    </button>
  )

  const cameraBox = (
    <div
      className={
        desktop
          ? cn(
              'relative shrink-0 overflow-hidden rounded-2xl border-2 border-white/10 bg-black',
              !boxSize && 'size-full'
            )
          : 'relative mx-auto aspect-[3/4] h-[50dvh] max-w-[calc(100%-1.5rem)] shrink-0 overflow-hidden rounded-3xl bg-black'
      }
      style={desktop && boxSize ? boxSize : undefined}
    >
      <video
        ref={videoRef}
        aria-hidden
        autoPlay
        muted
        playsInline
        className="absolute inset-0 size-full object-cover"
      />
      {guide && (
        <div
          aria-hidden
          className={cn(
            'pointer-events-none absolute rounded-xl border-2 border-dashed transition-colors',
            snapping ? 'border-amber-300 bg-amber-300/10' : 'border-white/70'
          )}
          style={{
            left: `${SNAP_BOX.left * 100}%`,
            top: `${SNAP_BOX.top * 100}%`,
            width: `${SNAP_BOX.width * 100}%`,
            height: `${SNAP_BOX.height * 100}%`
          }}
        >
          <span className="absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-black/55 px-2.5 py-0.5 text-[12px] text-white backdrop-blur-md">
            {SNAP_HINT}
          </span>
        </div>
      )}
      {desktop && game === 'op' && camera.stream !== null && (
        <button
          type="button"
          onClick={() => void readNumber()}
          disabled={!canSnap}
          className="absolute bottom-3 left-1/2 flex min-h-11 -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-full bg-black/60 px-4 text-[14px] font-medium text-white ring-1 ring-white/20 backdrop-blur-md hover:bg-black/70 active:scale-95 active:bg-black/75 disabled:opacity-70"
        >
          {snapping ? (
            <LoaderIcon aria-hidden className="size-4 animate-spin" />
          ) : (
            <ScanTextIcon aria-hidden className="size-4" />
          )}
          {snapping ? SNAP_READING : SNAP_BUTTON}
          {kbd('R')}
        </button>
      )}
      {snapProblem && (
        <p
          role="alert"
          className="pointer-events-none absolute inset-x-3 bottom-16 rounded-xl bg-black/70 px-3 py-2 text-center text-[13px] text-amber-200 backdrop-blur-md"
        >
          {snapProblem === 'many' ? SNAP_MANY : SNAP_NONE}
        </p>
      )}
      {flourish && (
        <div key={flourish.key} aria-hidden className="pointer-events-none absolute inset-0">
          {flourish.url && (
            <img
              src={flourish.url}
              alt=""
              className="absolute inset-0 size-full object-cover motion-safe:animate-[shot-fly_600ms_cubic-bezier(.5,0,.75,0)_forwards] motion-reduce:hidden"
            />
          )}
          <div className="absolute inset-0 rounded-3xl motion-safe:animate-[shot-ring_650ms_ease-out_forwards]" />
          <div className="absolute inset-0 bg-white opacity-0 animate-[shot-flash_260ms_ease-out]" />
        </div>
      )}
      {camera.error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 text-center text-sm text-white">
          <p>{CAMERA_MESSAGES[camera.error]}</p>
          <button
            type="button"
            onClick={camera.retry}
            className="min-h-11 rounded-full bg-white/15 px-4 active:bg-white/25"
          >
            Try again
          </button>
        </div>
      )}
      <p
        role="status"
        aria-label="Shot"
        className={cn(
          'pointer-events-none absolute left-1/2 top-3 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-emerald-500/90 px-3 py-1 text-sm font-semibold text-white shadow-lg transition-opacity',
          saved ? 'opacity-100' : 'opacity-0'
        )}
      >
        {saved ? (
          <span
            key={saved}
            className="flex items-center gap-1.5 motion-safe:animate-[scan-pop_1200ms_ease-out_forwards]"
          >
            <CheckIcon aria-hidden className="size-4" strokeWidth={3} />
            {SAVED}
          </span>
        ) : (
          ''
        )}
      </p>
    </div>
  )

  const numberSection = (
    <div className="space-y-2">
      <div className="flex items-end justify-between gap-2">
        <label htmlFor="training-number" className="px-1 text-[13px] text-muted-foreground">
          {NUMBER_LABEL}
        </label>
        <button
          type="button"
          onClick={nextCard}
          className="flex min-h-11 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium text-primary hover:bg-white/[0.04] active:bg-white/[0.06]"
        >
          Next card
          {kbd('N')}
        </button>
      </div>
      <input
        ref={numberInput}
        id="training-number"
        type="text"
        value={text}
        placeholder={NUMBER_PLACEHOLDER}
        autoCapitalize="characters"
        autoComplete="off"
        autoCorrect="off"
        autoFocus={desktop}
        spellCheck={false}
        inputMode="text"
        onChange={(e) => {
          setText(e.target.value)
          setSelected(null)
          setAutoFilled(false)
        }}
        key={`number-${filled}`}
        className={cn(
          'h-11 w-full rounded-xl border border-white/[0.08] bg-card px-3 text-base uppercase outline-none placeholder:normal-case placeholder:text-muted-foreground focus:border-white/25',
          filled > 0 && 'motion-safe:animate-[snap-fill_700ms_ease-out]'
        )}
      />
      {desktop && read !== null && (
        <button
          type="button"
          aria-label={`Use ${read}`}
          onClick={() => {
            setText(read)
            setSelected(null)
          }}
          className="flex min-h-11 w-full items-center gap-2 rounded-xl bg-primary/15 px-3 text-left ring-1 ring-primary/40 hover:bg-primary/20 active:bg-primary/25"
        >
          <ScanLineIcon aria-hidden className="size-4 shrink-0 text-primary" />
          <span className="text-[13px] text-muted-foreground">{READ_LABEL}</span>
          <span className="text-[15px] font-semibold tracking-wide">{read}</span>
          <span className="ml-auto flex items-center gap-1.5 text-[13px] font-medium text-primary">
            Use
            {kbd('Enter')}
          </span>
        </button>
      )}
      {chips.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {chips.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => {
                setText(c)
                setAutoFilled(false)
              }}
              className="min-h-11 rounded-full bg-white/[0.08] px-4 text-[15px] font-medium hover:bg-white/[0.12] active:bg-white/[0.16]"
            >
              {c}
            </button>
          ))}
        </div>
      )}
      {number !== null && versions.data?.length === 0 && (
        <p className="px-1 text-[13px] text-muted-foreground">{NO_VERSIONS}</p>
      )}
      {versions.data && versions.data.length > 0 && number !== null && (
        <>
          {desktop && versions.data.length > 1 && (
            <p className="flex items-center gap-1.5 px-1 text-[12px] text-muted-foreground">
              {kbd('←')}
              {kbd('→')}
              {VERSION_KEYS_HINT}
            </p>
          )}
          <div className="grid grid-cols-3 gap-2">
            {versions.data.map((v) => {
              const on = selected?.printingId === v.printingId
              return (
                <button
                  key={v.printingId}
                  type="button"
                  aria-label={v.label}
                  aria-pressed={on}
                  onClick={() => choose(v)}
                  className={cn(
                    'flex flex-col gap-1 rounded-xl p-1.5 text-left',
                    on
                      ? 'bg-primary/25 ring-2 ring-primary'
                      : 'bg-card hover:bg-white/[0.04] active:bg-white/[0.06]'
                  )}
                >
                  <img
                    src={cardImageSrc('small', v.imageId)}
                    alt=""
                    loading="lazy"
                    className="aspect-[63/88] w-full rounded-md bg-black/30 object-cover"
                  />
                  <span className="truncate text-[13px] font-medium">{v.label}</span>
                  <span className="truncate text-[11px] text-muted-foreground">{v.setName}</span>
                </button>
              )
            })}
          </div>
        </>
      )}
      {selected?.serverId === null && (
        <p role="alert" className="px-1 text-[13px] text-amber-300">
          {NOT_SYNCED}
        </p>
      )}
    </div>
  )

  const holderGroup = (
    <div
      role="group"
      aria-label="Holder"
      className="grid grid-cols-5 gap-1 rounded-2xl bg-card p-1"
    >
      {TRAINING_HOLDERS.map((h, i) => (
        <button
          key={h}
          type="button"
          aria-pressed={holder === h}
          onClick={() => setHolder(h)}
          className={cn(
            'flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-xl px-1 text-[12px] font-medium leading-tight transition-colors',
            holder === h
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-white/[0.04] active:bg-white/[0.06]'
          )}
        >
          {HOLDER_LABELS[h]}
          {desktop && (
            <span aria-hidden className="font-mono text-[10px] opacity-60">
              {i + 1}
            </span>
          )}
        </button>
      ))}
    </div>
  )

  const tips = (
    <details className={cn(panel, 'px-4 py-3 text-[13px]')}>
      <summary className="min-h-6 cursor-pointer font-medium">{WHAT_TO_SHOOT_TITLE}</summary>
      <ul className="mt-2 list-disc space-y-1 pl-4 text-muted-foreground">
        {WHAT_TO_SHOOT.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </details>
  )

  const shutter = (
    <>
      <div className="flex items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {selected && (
            <>
              <img
                src={cardImageSrc('small', selected.imageId)}
                alt=""
                className="aspect-[63/88] w-8 shrink-0 rounded object-cover"
              />
              <span className="min-w-0 text-[13px] leading-tight">
                <span className="block truncate">{selected.label}</span>
                {shotsOfSelected > 0 && (
                  <span className="block truncate text-[11px] text-emerald-300">
                    {shotsOf(shotsOfSelected)}
                  </span>
                )}
              </span>
            </>
          )}
        </div>
        <span className="flex shrink-0 flex-col items-center gap-1">
          <button
            type="button"
            aria-label="Take photo"
            disabled={!canShoot}
            onClick={shoot}
            className={cn(
              'flex size-16 shrink-0 items-center justify-center rounded-full bg-white text-black shadow-lg ring-4 ring-white/25 transition-transform hover:ring-white/40 active:scale-90 disabled:opacity-40',
              shooting && 'scale-90'
            )}
          >
            <CameraIcon aria-hidden className="size-7" />
          </button>
          {kbd('Space')}
        </span>
        <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
          {lastShot?.url && (
            <span className="relative shrink-0">
              <img
                key={lastShot.id}
                src={lastShot.url}
                alt="Last photo"
                className="size-11 rounded-lg object-cover ring-2 ring-white/70 motion-safe:animate-[shot-land_420ms_ease-out_250ms_both]"
              />
              <span className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full bg-emerald-500 text-[11px] font-semibold text-white">
                {stack.length}
              </span>
            </span>
          )}
          <button
            type="button"
            aria-label="Delete last photo"
            title={desktop ? 'Delete last photo (Backspace)' : undefined}
            disabled={stack.length === 0}
            onClick={() => void deleteLast()}
            className="flex size-11 items-center justify-center rounded-full bg-white/[0.06] hover:bg-white/[0.1] active:bg-white/[0.12] disabled:opacity-40"
          >
            <Trash2Icon aria-hidden className="size-5" />
          </button>
        </div>
      </div>
      {shotError && (
        <p role="alert" className="text-center text-[13px] text-destructive">
          {GRAB_FAILED}
        </p>
      )}
      <div
        role="status"
        aria-label="Photo count"
        className="text-center text-[12px] text-muted-foreground"
      >
        {count && <p>{count}</p>}
        {stopped === 'daily-cap' && <p>{CAP_REACHED}</p>}
        {stopped === 'offline' && <p>{OFFLINE_WAIT}</p>}
        {dropped && <p>{DROPPED}</p>}
      </div>
    </>
  )

  if (desktop)
    return (
      <div className="flex h-full flex-col bg-background text-foreground">
        <header className="flex shrink-0 items-center gap-3 border-b border-white/[0.06] px-4 py-2">
          {closeButton}
          <h1 className="text-lg font-semibold">{CONTRIBUTE_TITLE}</h1>
          <p className="ml-auto text-[12px] text-muted-foreground">{DESKTOP_KEYS_HINT}</p>
        </header>
        <div className="flex min-h-0 flex-1 gap-5 p-5">
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <div ref={stageRef} className="flex min-h-0 flex-1 items-center justify-center">
              {cameraBox}
            </div>
            {shutter}
          </div>
          <aside className="flex w-[360px] shrink-0 flex-col gap-4 overflow-auto">
            <Select
              value={activeCamera}
              onValueChange={pickCamera}
              disabled={camera.devices.length === 0}
            >
              <SelectTrigger aria-label="Camera" className="w-full">
                <CameraIcon aria-hidden className="size-4 text-muted-foreground" />
                <SelectValue
                  placeholder={camera.devices.length ? 'Choose a camera' : 'No camera'}
                />
              </SelectTrigger>
              <SelectContent>
                {camera.devices.map((d, i) => (
                  <SelectItem key={d.deviceId || i} value={d.deviceId || `${UNNAMED_CAMERA}${i}`}>
                    {d.label || `Camera ${i + 1}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {numberSection}
            {holderGroup}
            {tips}
          </aside>
        </div>
      </div>
    )

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <header className="flex shrink-0 items-center gap-2 px-2 pb-2 pt-[calc(env(safe-area-inset-top)+0.5rem)]">
        {closeButton}
        <h1 className="text-lg font-semibold">{CONTRIBUTE_TITLE}</h1>
      </header>

      {cameraBox}
      {showTiming && game === 'op' && (
        <p
          aria-label="Read timing"
          className="-mb-2 mt-1 shrink-0 text-center text-[11px] tabular-nums text-muted-foreground/70"
        >
          {timingText(timing)}
        </p>
      )}

      <div className="min-h-0 flex-1 space-y-4 overflow-auto overscroll-contain px-3 py-3">
        {numberSection}
        {holderGroup}
        {tips}
      </div>

      <footer className="shrink-0 space-y-2 border-t border-white/[0.08] bg-background/90 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur-xl">
        {shutter}
      </footer>
    </div>
  )
}
