import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CameraIcon, Trash2Icon, XIcon } from 'lucide-react'
import { useScanHub } from '@/features/scan/ScanHub'
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
import { usePhone } from '../context'
import { appVersion, deviceModel, grabFrame, newClientId } from './capture'
import {
  CAP_REACHED,
  CONTRIBUTE_TITLE,
  DROPPED,
  GRAB_FAILED,
  NOT_SYNCED,
  NO_VERSIONS,
  NUMBER_LABEL,
  NUMBER_PLACEHOLDER,
  OFFLINE_WAIT,
  SAVED,
  WHAT_TO_SHOOT,
  WHAT_TO_SHOOT_TITLE,
  photoCount
} from './copy'
import { trainingOutbox, type DrainResult, type Outbox } from './outbox'

const HOLDER_KEY = 'training.holder'
const DRAIN_EVERY_MS = 30_000
const SAVED_MS = 1200

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

const panel = 'rounded-2xl border border-white/[0.08] bg-black/45 backdrop-blur-md'

/**
 * Testers' training photos: type a card's number, pick the version in hand and its holder, then
 * shoot. Each shot goes to the outbox with its own label and uploads from there (also after this
 * screen closes, through the shell's drain).
 */
export function ContributeScreen({
  game,
  onClose,
  outbox: given,
  grab = grabFrame,
  now = () => new Date()
}: {
  game: GameId
  onClose(): void
  /** Tests. Default `trainingOutbox()`. */ outbox?: Outbox
  /** Tests. */ grab?: (video: HTMLVideoElement) => Promise<ArrayBuffer>
  /** Tests. */ now?: () => Date
}): React.JSX.Element {
  const { store, user } = usePhone()
  const outbox = useMemo(() => given ?? trainingOutbox(), [given])
  const { settings } = useScanHub()
  const camera = useCamera(settings.deviceId, 'environment')
  const videoRef = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    video.srcObject = camera.stream
    if (camera.stream) void video.play?.()?.catch(() => undefined)
  }, [camera.stream])

  const [text, setText] = useState('')
  const number = normalizeOpNumber(text)
  const prefixes = useQuery({
    queryKey: ['training', 'numberPrefixes'],
    queryFn: () => api.scan.numberPrefixes()
  })
  const chips = prefixSuggestions(text, prefixes.data ?? [])
  const versions = useQuery({
    queryKey: ['training', 'versions', number],
    queryFn: () => versionsOf(number!),
    enabled: number !== null
  })

  const [selected, setSelected] = useState<Selected | null>(null)
  const choose = (v: Version): void => {
    setSelected({ ...v, serverId: undefined })
    void store
      .printingPhotoIds([v.printingId])
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
    const s = await store.trainingSummary(game).catch(() => null)
    // Offline or refused: the last known numbers stay.
    if (s && live.current) setSummary(s)
  }, [store, game])
  const readWaiting = useCallback(async (): Promise<void> => {
    const n = await outbox.waiting(user.id).catch(() => 0)
    if (live.current) setWaiting(n)
  }, [outbox, user.id])

  const drain = useCallback(async (): Promise<void> => {
    let r: DrainResult
    try {
      r = await outbox.drain(user.id, {
        upload: (id, label, jpeg) => store.trainingUpload(id, label, jpeg),
        remove: (id) => store.trainingDelete(id)
      })
    } catch {
      return
    }
    if (!live.current) return
    setStopped(r.stopped)
    if (r.dropped.length > 0) setDropped(true)
    void readSummary()
    void readWaiting()
  }, [outbox, user.id, store, readSummary, readWaiting])

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
  const [stack, setStack] = useState<string[]>([])
  const [shooting, setShooting] = useState(false)
  const [shotError, setShotError] = useState(false)
  const [saved, setSaved] = useState(0)
  useEffect(() => {
    if (!saved) return
    const t = setTimeout(() => setSaved(0), SAVED_MS)
    return () => clearTimeout(t)
  }, [saved])

  const serverId = selected?.serverId ?? null
  const canShoot = serverId !== null && camera.stream !== null && !shooting

  const shoot = async (): Promise<void> => {
    const video = videoRef.current
    if (!selected || serverId === null || !video) return
    const takenAt = now().toISOString()
    setShooting(true)
    setShotError(false)
    try {
      let jpeg: ArrayBuffer
      try {
        jpeg = await grab(video)
      } catch {
        setShotError(true)
        return
      }
      const label: TrainingLabel = {
        game,
        cardId: selected.cardId,
        printingId: serverId,
        holder,
        device: await deviceModel(),
        appVersion: appVersion(),
        takenAt
      }
      const id = newClientId()
      await outbox.addUpload(user.id, id, label, jpeg)
      setStack((s) => [...s, id])
      setSaved((n) => n + 1)
    } catch {
      setShotError(true)
      return
    } finally {
      setShooting(false)
    }
    void drain()
  }

  const deleteLast = async (): Promise<void> => {
    const id = stack[stack.length - 1]
    if (!id) return
    setStack((s) => s.slice(0, -1))
    await outbox.forget(user.id, id).catch(() => undefined)
    void drain()
  }

  const nextCard = (): void => {
    setText('')
    setSelected(null)
    setShotError(false)
  }

  const count = photoCount(summary, waiting)

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <header className="flex shrink-0 items-center gap-2 px-2 pb-2 pt-[calc(env(safe-area-inset-top)+0.5rem)]">
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="flex size-11 items-center justify-center rounded-full bg-white/[0.06] active:bg-white/[0.12]"
        >
          <XIcon aria-hidden className="size-5" />
        </button>
        <h1 className="text-lg font-semibold">{CONTRIBUTE_TITLE}</h1>
      </header>

      <div className="relative mx-3 h-[34vh] shrink-0 overflow-hidden rounded-3xl bg-black">
        <video
          ref={videoRef}
          aria-hidden
          autoPlay
          muted
          playsInline
          className="size-full object-cover"
        />
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
            'pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-sm font-medium text-white backdrop-blur-md transition-opacity',
            saved ? 'opacity-100' : 'opacity-0'
          )}
        >
          {saved ? SAVED : ''}
        </p>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-auto overscroll-contain px-3 py-3">
        <div className="space-y-2">
          <div className="flex items-end justify-between gap-2">
            <label htmlFor="training-number" className="px-1 text-[13px] text-muted-foreground">
              {NUMBER_LABEL}
            </label>
            <button
              type="button"
              onClick={nextCard}
              className="min-h-11 rounded-full px-3 text-[13px] font-medium text-primary active:bg-white/[0.06]"
            >
              Next card
            </button>
          </div>
          <input
            id="training-number"
            type="text"
            value={text}
            placeholder={NUMBER_PLACEHOLDER}
            autoCapitalize="characters"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            inputMode="text"
            onChange={(e) => {
              setText(e.target.value)
              setSelected(null)
            }}
            className="h-11 w-full rounded-xl border border-white/[0.08] bg-card px-3 text-base uppercase outline-none placeholder:normal-case placeholder:text-muted-foreground focus:border-white/25"
          />
          {chips.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {chips.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setText(c)}
                  className="min-h-11 rounded-full bg-white/[0.08] px-4 text-[15px] font-medium active:bg-white/[0.16]"
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
                      on ? 'bg-primary/25 ring-2 ring-primary' : 'bg-card active:bg-white/[0.06]'
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
          )}
          {selected?.serverId === null && (
            <p role="alert" className="px-1 text-[13px] text-amber-300">
              {NOT_SYNCED}
            </p>
          )}
        </div>

        <div
          role="group"
          aria-label="Holder"
          className="grid grid-cols-5 gap-1 rounded-2xl bg-card p-1"
        >
          {TRAINING_HOLDERS.map((h) => (
            <button
              key={h}
              type="button"
              aria-pressed={holder === h}
              onClick={() => setHolder(h)}
              className={cn(
                'min-h-11 rounded-xl px-1 text-[12px] font-medium leading-tight transition-colors',
                holder === h
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground active:bg-white/[0.06]'
              )}
            >
              {HOLDER_LABELS[h]}
            </button>
          ))}
        </div>

        <details className={cn(panel, 'px-4 py-3 text-[13px]')}>
          <summary className="min-h-6 cursor-pointer font-medium">{WHAT_TO_SHOOT_TITLE}</summary>
          <ul className="mt-2 list-disc space-y-1 pl-4 text-muted-foreground">
            {WHAT_TO_SHOOT.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </details>
      </div>

      <footer className="shrink-0 space-y-2 border-t border-white/[0.08] bg-background/90 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur-xl">
        <div className="flex items-center gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {selected && (
              <>
                <img
                  src={cardImageSrc('small', selected.imageId)}
                  alt=""
                  className="aspect-[63/88] w-8 shrink-0 rounded object-cover"
                />
                <span className="min-w-0 truncate text-[13px]">{selected.label}</span>
              </>
            )}
          </div>
          <button
            type="button"
            aria-label="Take photo"
            disabled={!canShoot}
            onClick={() => void shoot()}
            className="flex size-16 shrink-0 items-center justify-center rounded-full bg-white text-black shadow-lg ring-4 ring-white/25 active:scale-95 disabled:opacity-40"
          >
            <CameraIcon aria-hidden className="size-7" />
          </button>
          <div className="flex min-w-0 flex-1 justify-end gap-1">
            <button
              type="button"
              aria-label="Delete last photo"
              disabled={stack.length === 0}
              onClick={() => void deleteLast()}
              className="flex size-11 items-center justify-center rounded-full bg-white/[0.06] active:bg-white/[0.12] disabled:opacity-40"
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
      </footer>
    </div>
  )
}
