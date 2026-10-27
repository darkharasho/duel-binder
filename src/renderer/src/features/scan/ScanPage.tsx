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
import { defaultEngine, type ScanEngine } from './engine'
import type { ScanDraft } from './resolve'
import { ScanRowItem } from './ScanRowItem'
import { SearchPicker, type PickerOption } from './SearchPicker'
import { rowKey, useScanSession } from './session'
import { rememberedCamera, useCamera, type CameraError } from './useCamera'
import { useScanLoop, type ScanStatus } from './useScanLoop'

const SET_KEY = 'scan.set'
const RARITY_KEY = 'scan.defaultRarity'
const ANY = 'any'
const AUTO = 'auto'
const HIGHLIGHT_MS = 1500
const RARITY_OPTIONS: PickerOption[] = [
  { key: AUTO, label: 'Auto' },
  ...RARITY_TIERS.map((r) => ({ key: r, label: r }))
]
const UNNAMED_CAMERA = 'unnamed-camera-'

const CAMERA_MESSAGES: Record<CameraError, string> = {
  denied: 'Camera access was denied. Allow it in your system settings, then reopen Scan.',
  none: 'No camera found. Plug one in and reopen Scan.',
  lost: "The camera stopped. Check it's connected, then pick it again."
}

const SET_UNREADABLE = "Couldn't load this set's cards, so cards are matched against every set."

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

interface PickedSet {
  setName: string
  language: Language
}

const parseSet = (raw: string): PickedSet | null => {
  const v = JSON.parse(raw) as Partial<PickedSet>
  return typeof v.setName === 'string' && isLanguage(v.language)
    ? { setName: v.setName, language: v.language }
    : null
}

const setKeyOf = (s: PickedSet): string => `${s.language}|${s.setName}`

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
      return 'Scanning stopped after repeated errors.'
  }
}

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

  // Not refetched while scanning (focus or staleness); data-changed events still invalidate it.
  const sets = useQuery({
    queryKey: queryKeys.setsList,
    queryFn: () => api.sets.list(),
    staleTime: Infinity,
    refetchOnWindowFocus: false
  })
  const setOptions = useMemo(() => {
    const order = new Map(LANGUAGES.map((l, i) => [l.code, i]))
    const byName = new Intl.Collator('en').compare
    const sorted = (sets.data ?? [])
      .map((s) => ({ setName: s.setName, language: s.language }))
      .sort(
        (a, b) =>
          byName(a.setName, b.setName) ||
          (order.get(a.language) ?? 0) - (order.get(b.language) ?? 0)
      )
    const options: PickerOption[] = [{ key: ANY, label: 'Any set' }]
    const byKey = new Map<string, PickedSet>()
    for (const s of sorted) {
      const key = setKeyOf(s)
      const label = `${s.setName} · ${languageInfo(s.language).tag}`
      byKey.set(key, s)
      options.push({ key, label, search: label.toLowerCase() })
    }
    return { options, byKey }
  }, [sets.data])

  const setPrintings = useQuery({
    queryKey: ['scan', 'setPrintings', picked?.setName, picked?.language],
    queryFn: () => api.scan.printingsForSet(picked!.setName, picked!.language),
    enabled: picked !== null,
    staleTime: Infinity,
    refetchOnWindowFocus: false
  })

  const { add, setPrinting, setQuantity, remove } = session
  // Stable, so rows (memoized) don't re-render on every camera frame.
  const rowActions = useMemo(
    () => ({ setPrinting, setQuantity, remove }),
    [setPrinting, setQuantity, remove]
  )
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

  // A set whose printings can't be read scans as any set rather than not at all.
  const setUnreadable = picked !== null && setPrintings.isError
  const scanSet = setUnreadable ? null : picked
  const loop = useScanLoop({
    videoRef,
    engineFactory,
    running: camera.stream !== null && !paused,
    setName: scanSet?.setName ?? null,
    setKey: scanSet ? setKeyOf(scanSet) : ANY,
    setPrintings: scanSet === null ? null : setPrintings.data,
    defaultRarity,
    onDraft
  })

  useEffect(() => {
    const video = videoRef.current
    if (video) video.srcObject = camera.stream
  }, [camera.stream])

  const { byKey } = setOptions
  // A remembered set missing from the list (still loading, say) still shows as picked.
  const pickedSetOptions = useMemo(
    () =>
      picked && !byKey.has(setKeyOf(picked))
        ? [
            ...setOptions.options,
            {
              key: setKeyOf(picked),
              label: `${picked.setName} · ${languageInfo(picked.language).tag}`
            }
          ]
        : setOptions.options,
    [picked, byKey, setOptions.options]
  )
  const pickSet = useCallback(
    (key: string): void => {
      setPicked((current) => {
        const next = byKey.get(key) ?? (current && key === setKeyOf(current) ? current : null)
        write(SET_KEY, next ? JSON.stringify(next) : null)
        return next
      })
    },
    [byKey]
  )

  const pickRarity = useCallback((value: string): void => {
    const next = value === AUTO ? null : value
    setDefaultRarity(next)
    write(RARITY_KEY, next)
  }, [])

  const pickCamera = (id: string): void => {
    // A camera listed before permission has no id: open the default one.
    setDeviceId(id.startsWith(UNNAMED_CAMERA) ? null : id)
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

  const openCamera = camera.stream?.getVideoTracks()[0]?.getSettings().deviceId ?? deviceId ?? ''
  // Shown as picked only when it's one of the listed cameras (ids are blank before permission),
  // and not while the camera is in error, so picking it again reopens it.
  const activeCamera =
    !camera.error && camera.devices.some((d) => d.deviceId === openCamera) ? openCamera : ''
  const outline = loop.outline

  return (
    <div className="p-8">
      <PageHeader>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="mr-auto text-2xl font-semibold tracking-tight">Scan</h1>
          <SearchPicker
            label="Set"
            value={picked ? setKeyOf(picked) : ANY}
            options={pickedSetOptions}
            onPick={pickSet}
            searchPlaceholder="Search sets…"
            className="w-72"
          />
          <Select
            value={activeCamera}
            onValueChange={pickCamera}
            disabled={camera.devices.length === 0}
          >
            <SelectTrigger size="sm" aria-label="Camera" className="w-56">
              <SelectValue placeholder={camera.devices.length ? 'Choose a camera' : 'No camera'} />
            </SelectTrigger>
            <SelectContent>
              {camera.devices.map((d, i) => (
                <SelectItem key={d.deviceId || i} value={d.deviceId || `${UNNAMED_CAMERA}${i}`}>
                  {d.label || `Camera ${i + 1}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </PageHeader>

      <div className="mt-6 flex gap-6">
        <section aria-label="Camera" className="flex w-min shrink-0 flex-col gap-3">
          <div
            className={cn(
              // Portrait, as tall as the window allows below the header and above the controls.
              'relative aspect-[3/4] h-[calc(100vh-15rem)] min-h-72 overflow-hidden rounded-lg border-2 bg-black',
              loop.flash ? 'border-emerald-400' : 'border-white/10'
            )}
          >
            {camera.error ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center text-sm text-muted-foreground">
                <p>{CAMERA_MESSAGES[camera.error]}</p>
                {camera.error !== 'denied' && (
                  <Button variant="outline" size="sm" onClick={camera.retry}>
                    Try again
                  </Button>
                )}
              </div>
            ) : (
              <>
                <video
                  ref={videoRef}
                  autoPlay
                  muted
                  playsInline
                  className="h-full w-full object-cover object-center"
                />
                {outline && (
                  <svg
                    aria-hidden
                    viewBox={`0 0 ${outline.width} ${outline.height}`}
                    preserveAspectRatio="xMidYMid slice"
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
                <div className="absolute inset-x-0 bottom-0 flex items-center gap-3 bg-black/70 px-4 py-2 text-sm text-white">
                  <p role="status">{statusText(loop.status)}</p>
                  {loop.status.kind === 'stopped' && (
                    <Button variant="outline" size="xs" className="ml-auto" onClick={loop.retry}>
                      Retry
                    </Button>
                  )}
                </div>
              </>
            )}
          </div>
          {setUnreadable && <p className="text-xs text-muted-foreground">{SET_UNREADABLE}</p>}
          {loop.artReady === false && (
            <p className="text-xs text-muted-foreground">{NO_FINGERPRINTS}</p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-muted-foreground">New scans as</span>
            <SearchPicker
              label="New scans as"
              value={defaultRarity ?? AUTO}
              options={RARITY_OPTIONS}
              onPick={pickRarity}
              searchPlaceholder="Search rarities…"
              className="w-48"
            />
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
          className="flex h-[calc(100vh-15rem)] min-h-72 min-w-0 flex-1 flex-col rounded-lg border border-white/[0.08]"
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
                    actions={rowActions}
                    highlighted={row.key === fresh}
                    disabled={session.committing}
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
