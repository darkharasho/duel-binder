import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { LANGUAGES, isLanguage, languageInfo, type Language } from '@shared/languages'
import { RARITY_TIERS } from '@shared/scan/rarity'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { api, queryKeys } from '@/lib/api'
import { cn } from '@/lib/utils'
import { createScanEngine, makeVisionWorker, type ScanEngine } from './engine'
import type { ScanDraft } from './resolve'
import { ScanRowItem } from './ScanRowItem'
import { rowKey, useScanSession } from './session'
import { rememberedCamera, useCamera, type CameraError } from './useCamera'
import { useScanLoop, type ScanStatus } from './useScanLoop'

const SET_KEY = 'scan.set'
const RARITY_KEY = 'scan.defaultRarity'
const ANY = 'any'
const AUTO = 'auto'
const HIGHLIGHT_MS = 1500

interface PickedSet {
  setName: string
  language: Language
}

const CAMERA_MESSAGES: Record<CameraError, string> = {
  denied: 'Camera access was denied. Allow it in your system settings, then reopen Scan.',
  none: 'No camera found. Plug one in and reopen Scan.',
  lost: "The camera stopped. Check it's connected, then pick it again."
}

const NO_FINGERPRINTS =
  'Artwork matching is unavailable until the artwork data downloads. Set codes and names still work.'

function read<T>(key: string, parse: (raw: string) => T | null): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw === null ? null : parse(raw)
  } catch {
    return null
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // Unavailable storage only costs the remembered choice.
  }
}

const parseSet = (raw: string): PickedSet | null => {
  const v = JSON.parse(raw) as Partial<PickedSet>
  return typeof v.setName === 'string' && isLanguage(v.language)
    ? { setName: v.setName, language: v.language }
    : null
}

const setValue = (s: PickedSet): string => JSON.stringify([s.language, s.setName])
const setLabel = (s: PickedSet): string => `${s.setName} · ${languageInfo(s.language).tag}`

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

function statusText(s: ScanStatus): string {
  switch (s.kind) {
    case 'idle':
      return 'Hold a card up'
    case 'unsure':
      return "Couldn't recognize this card"
    case 'added':
      return `${s.setCode ? `${s.name} ${s.setCode}` : s.name} · added, lower it to scan the next card`
    case 'stopped':
      return 'Scanning stopped after repeated errors. Reopen Scan to try again.'
  }
}

const defaultEngine = (): ScanEngine =>
  createScanEngine({ api: window.api.scan, makeWorker: makeVisionWorker })

/** Desktop only: scan cards held up to the webcam onto a list, then add the list. */
export function ScanPage({
  engineFactory = defaultEngine
}: {
  engineFactory?: () => ScanEngine
}): React.JSX.Element {
  const session = useScanSession()
  const [picked, setPicked] = useState<PickedSet | null>(() => read(SET_KEY, parseSet))
  const [defaultRarity, setDefaultRarity] = useState<string | null>(() =>
    read(RARITY_KEY, (r) => (RARITY_TIERS.includes(r) ? r : null))
  )
  const [deviceId, setDeviceId] = useState<string | null>(rememberedCamera)
  const [paused, setPaused] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [fresh, setFresh] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const camera = useCamera(deviceId)

  const sets = useQuery({ queryKey: queryKeys.setsList, queryFn: () => api.sets.list() })
  const setOptions = useMemo(() => {
    const order = new Map(LANGUAGES.map((l, i) => [l.code, i]))
    return (sets.data ?? [])
      .map((s) => ({ setName: s.setName, language: s.language }))
      .sort(
        (a, b) =>
          a.setName.localeCompare(b.setName) ||
          (order.get(a.language) ?? 0) - (order.get(b.language) ?? 0)
      )
  }, [sets.data])

  const setPrintings = useQuery({
    queryKey: ['scan', 'setPrintings', picked?.setName, picked?.language],
    queryFn: () => api.scan.printingsForSet(picked!.setName, picked!.language),
    enabled: picked !== null,
    staleTime: Infinity
  })

  const { add } = session
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const onDraft = useCallback(
    (d: ScanDraft) => {
      add(d)
      setFresh(rowKey(d))
      clearTimeout(highlightTimer.current)
      highlightTimer.current = setTimeout(() => setFresh(null), HIGHLIGHT_MS)
    },
    [add]
  )
  useEffect(() => () => clearTimeout(highlightTimer.current), [])

  const loop = useScanLoop({
    videoRef,
    engineFactory,
    running: camera.stream !== null && !paused,
    setName: picked?.setName ?? null,
    setKey: picked ? setValue(picked) : ANY,
    // A set whose printings can't be read scans as any set rather than not at all.
    setPrintings: picked === null || setPrintings.isError ? null : setPrintings.data,
    defaultRarity,
    onDraft
  })

  useEffect(() => {
    const video = videoRef.current
    if (video) video.srcObject = camera.stream
  }, [camera.stream])

  const pickSet = (value: string): void => {
    if (value === ANY) {
      setPicked(null)
      write(SET_KEY, null)
      return
    }
    const [language, setName] = JSON.parse(value) as [Language, string]
    const next = { setName, language }
    setPicked(next)
    write(SET_KEY, JSON.stringify(next))
  }

  const pickRarity = (value: string): void => {
    const next = value === AUTO ? null : value
    setDefaultRarity(next)
    write(RARITY_KEY, next)
  }

  const pickCamera = (id: string): void => {
    setDeviceId(id)
    camera.retry()
  }

  const addable = session.rows
    .filter((r) => r.printingId !== null)
    .reduce((n, r) => n + r.quantity, 0)

  const commit = async (): Promise<void> => {
    const { cards, failed } = await session.commit()
    if (cards > 0) toast.success(`Added ${plural(cards, 'card', 'cards')}`)
    if (failed > 0)
      toast.error(`${plural(failed, 'entry', 'entries')} couldn't be added; see the list`)
  }

  const activeCamera =
    camera.stream?.getVideoTracks()[0]?.getSettings().deviceId ?? deviceId ?? undefined
  const outline = loop.outline

  return (
    <div className="p-8">
      <PageHeader>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="mr-auto text-2xl font-semibold tracking-tight">Scan</h1>
          <Select value={picked ? setValue(picked) : ANY} onValueChange={pickSet}>
            <SelectTrigger size="sm" aria-label="Set" className="w-72">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Any set</SelectItem>
              {picked && !setOptions.some((s) => setValue(s) === setValue(picked)) && (
                <SelectItem value={setValue(picked)}>{setLabel(picked)}</SelectItem>
              )}
              {setOptions.map((s) => (
                <SelectItem key={setValue(s)} value={setValue(s)}>
                  {setLabel(s)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={activeCamera}
            onValueChange={pickCamera}
            disabled={camera.devices.length === 0}
          >
            <SelectTrigger size="sm" aria-label="Camera" className="w-56">
              <SelectValue placeholder="No camera" />
            </SelectTrigger>
            <SelectContent>
              {camera.devices.map((d, i) => (
                <SelectItem key={d.deviceId || i} value={d.deviceId || `camera-${i}`}>
                  {d.label || `Camera ${i + 1}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </PageHeader>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <section aria-label="Camera" className="space-y-3">
          <div
            className={cn(
              'relative aspect-video overflow-hidden rounded-lg border-2 bg-black',
              loop.flash ? 'border-emerald-400' : 'border-white/10'
            )}
          >
            {camera.error ? (
              <div className="flex h-full items-center justify-center p-8 text-center text-sm text-muted-foreground">
                <p>{CAMERA_MESSAGES[camera.error]}</p>
              </div>
            ) : (
              <>
                <video
                  ref={videoRef}
                  autoPlay
                  muted
                  playsInline
                  className="h-full w-full object-contain"
                />
                {outline && (
                  <svg
                    aria-hidden
                    viewBox={`0 0 ${outline.width} ${outline.height}`}
                    preserveAspectRatio="xMidYMid meet"
                    className="pointer-events-none absolute inset-0 h-full w-full"
                  >
                    <polygon
                      points={outline.quad.map(([x, y]) => `${x},${y}`).join(' ')}
                      fill="none"
                      stroke="#34d399"
                      strokeWidth={3}
                      strokeLinejoin="round"
                      vectorEffect="non-scaling-stroke"
                    />
                  </svg>
                )}
                <p
                  role="status"
                  className="absolute inset-x-0 bottom-0 bg-black/70 px-4 py-2 text-sm text-white"
                >
                  {statusText(loop.status)}
                </p>
              </>
            )}
          </div>
          {loop.artReady === false && (
            <p className="text-xs text-muted-foreground">{NO_FINGERPRINTS}</p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-muted-foreground">New scans as</span>
            <Select value={defaultRarity ?? AUTO} onValueChange={pickRarity}>
              <SelectTrigger size="sm" aria-label="New scans as" className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={AUTO}>Auto</SelectItem>
                {RARITY_TIERS.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              className="ml-auto"
              disabled={camera.stream === null}
              onClick={() => setPaused((p) => !p)}
            >
              {paused ? 'Resume' : 'Pause'}
            </Button>
          </div>
        </section>

        <section
          aria-labelledby="scan-session-title"
          className="flex max-h-[calc(100vh-10rem)] min-h-80 flex-col rounded-lg border border-white/[0.08]"
        >
          <header className="flex items-baseline justify-between border-b border-white/[0.06] px-4 py-3">
            <h2 id="scan-session-title" className="text-sm font-semibold">
              This session
            </h2>
            <span className="text-xs text-muted-foreground tabular-nums">
              {plural(session.total, 'card', 'cards')} ·{' '}
              {plural(session.rows.length, 'entry', 'entries')}
            </span>
          </header>
          <div className="min-h-0 flex-1 overflow-auto">
            {session.rows.length === 0 ? (
              <p className="px-4 py-8 text-sm text-muted-foreground">
                Cards you scan show up here.
              </p>
            ) : (
              <ul aria-label="This session" className="divide-y divide-white/[0.06]">
                {session.rows.map((row) => (
                  <ScanRowItem
                    key={row.key}
                    row={row}
                    actions={session}
                    highlighted={row.key === fresh}
                  />
                ))}
              </ul>
            )}
          </div>
          <footer className="flex items-center gap-2 border-t border-white/[0.06] p-3">
            <Button
              variant="ghost"
              size="sm"
              disabled={session.rows.length === 0 || session.committing}
              onClick={() => setClearing(true)}
            >
              Clear
            </Button>
            <Button
              size="sm"
              className="ml-auto"
              disabled={addable === 0 || session.committing}
              onClick={() => void commit()}
            >
              Add {plural(addable, 'card', 'cards')} to collection
            </Button>
          </footer>
        </section>
      </div>

      <Dialog open={clearing} onOpenChange={setClearing}>
        <DialogContent showCloseButton={false} className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Clear this session?</DialogTitle>
            <DialogDescription>
              The scanned cards are removed from the list. Nothing is added to your collection.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setClearing(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                session.clear()
                setClearing(false)
              }}
            >
              Clear list
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
