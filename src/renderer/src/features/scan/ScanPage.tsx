import { useCallback, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { LANGUAGES, languageInfo, type Language } from '@shared/languages'
import { RARITY_TIERS } from '@shared/scan/rarity'
import type { ScanStatus, ScanWindowState } from '@shared/scanWindow'
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
import { useScanHub } from './ScanHub'
import { ScanRowItem } from './ScanRowItem'
import { SearchPicker, type PickerOption } from './SearchPicker'

const ANY = 'any'
const AUTO = 'auto'
const RARITY_OPTIONS: PickerOption[] = [
  { key: AUTO, label: 'Auto' },
  ...RARITY_TIERS.map((r) => ({ key: r, label: r }))
]
const UNNAMED_CAMERA = 'unnamed-camera-'

const CAMERA_MESSAGES: Record<NonNullable<ScanWindowState['cameraError']>, string> = {
  denied:
    'Camera access was denied. Allow it in your system settings, then reopen the scan window.',
  none: 'No camera found. Plug one in and reopen the scan window.',
  lost: "The camera stopped. Check it's connected, then pick it again."
}

const SET_UNREADABLE = "Couldn't load this set's cards, so cards are matched against every set."

const NO_FINGERPRINTS =
  'Artwork matching is unavailable until the artwork data downloads. Set codes and names still work.'

interface PickedSet {
  setName: string
  language: Language
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

/** Desktop only: the scan list and the controls for the scan window, which does the scanning. */
export function ScanPage(): React.JSX.Element {
  const hub = useScanHub()
  const { session, settings, setSettings, state, open, fresh } = hub
  const picked = settings.set
  const [clearing, setClearing] = useState(false)

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

  const { setPrinting, setQuantity, remove } = session
  // Stable, so rows (memoized) don't re-render on every pull.
  const rowActions = useMemo(
    () => ({ setPrinting, setQuantity, remove }),
    [setPrinting, setQuantity, remove]
  )

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
      setSettings({
        set: byKey.get(key) ?? (picked && key === setKeyOf(picked) ? picked : null)
      })
    },
    [byKey, picked, setSettings]
  )

  const pickRarity = useCallback(
    (value: string): void => {
      setSettings({ defaultRarity: value === AUTO ? null : value })
    },
    [setSettings]
  )

  const pickCamera = (id: string): void => {
    // A camera listed before permission has no id: open the default one.
    const deviceId = id.startsWith(UNNAMED_CAMERA) ? null : id
    setSettings({ deviceId })
    // A different camera opens from the settings change; re-picking the current one retries it.
    if (deviceId === settings.deviceId) hub.retryCamera()
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

  const devices = state?.devices ?? []
  const openCamera = state?.openDeviceId ?? null
  // Shown as picked only when it's one of the listed cameras (ids are blank before permission),
  // and not while the camera is in error, so picking it again reopens it.
  const activeCamera =
    state && !state.cameraError && devices.some((d) => d.deviceId === openCamera)
      ? (openCamera ?? '')
      : ''

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
            disabled={!open || devices.length === 0}
          >
            <SelectTrigger size="sm" aria-label="Camera" className="w-56">
              <SelectValue placeholder={devices.length ? 'Choose a camera' : 'No camera'} />
            </SelectTrigger>
            <SelectContent>
              {devices.map((d, i) => (
                <SelectItem key={d.deviceId || i} value={d.deviceId || `${UNNAMED_CAMERA}${i}`}>
                  {d.label || `Camera ${i + 1}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </PageHeader>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Button variant="outline" size="sm" onClick={hub.openWindow}>
          {open ? 'Show scan window' : 'Open scan window'}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!open || openCamera === null}
          onClick={() => setSettings({ paused: !settings.paused })}
        >
          {settings.paused ? 'Resume' : 'Pause'}
        </Button>
        <span className="ml-3 text-sm text-muted-foreground">New scans as</span>
        <SearchPicker
          label="New scans as"
          value={settings.defaultRarity ?? AUTO}
          options={RARITY_OPTIONS}
          onPick={pickRarity}
          searchPlaceholder="Search rarities…"
          className="w-48"
        />
        <HitPriceInput
          value={settings.hitPrice}
          onCommit={(hitPrice) => setSettings({ hitPrice })}
        />
      </div>

      <div className="mt-3 flex flex-col gap-1 text-sm">
        {!open ? (
          <p className="text-muted-foreground">
            The scan window is closed. Open it to start scanning.
          </p>
        ) : state?.cameraError ? (
          <div className="flex items-center gap-3">
            <p role="status">{CAMERA_MESSAGES[state.cameraError]}</p>
            {state.cameraError !== 'denied' && (
              <Button variant="outline" size="xs" onClick={hub.retryCamera}>
                Try again
              </Button>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <p role="status">
              {settings.paused
                ? 'Paused'
                : !state || state.openDeviceId === null
                  ? 'Starting camera…'
                  : statusText(state.loop)}
            </p>
            {!settings.paused && state?.loop.kind === 'stopped' && (
              <Button variant="outline" size="xs" onClick={hub.retryScan}>
                Retry
              </Button>
            )}
          </div>
        )}
        {open && state?.setUnreadable && (
          <p className="text-xs text-muted-foreground">{SET_UNREADABLE}</p>
        )}
        {open && state?.artReady === false && (
          <p className="text-xs text-muted-foreground">{NO_FINGERPRINTS}</p>
        )}
      </div>

      <section
        aria-labelledby="scan-session-title"
        className="mt-6 flex h-[calc(100vh-17rem)] min-h-72 min-w-0 flex-col rounded-lg border border-white/[0.08]"
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
            <p className="px-4 py-8 text-sm text-muted-foreground">Cards you scan show up here.</p>
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

/** A dollar amount that commits on blur or Enter; anything but a number above 0 reverts. */
function HitPriceInput({
  value,
  onCommit
}: {
  value: number
  onCommit: (v: number) => void
}): React.JSX.Element {
  const [text, setText] = useState(String(value))
  const commit = (): void => {
    const n = Number(text)
    if (text.trim() !== '' && Number.isFinite(n) && n > 0) {
      onCommit(n)
      setText(String(n))
    } else setText(String(value))
  }
  return (
    <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
      <label htmlFor="scan-hit-price">Hit price</label>
      <span aria-hidden>$</span>
      <input
        id="scan-hit-price"
        type="number"
        min={0}
        step="any"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
        }}
        className="h-8 w-20 rounded-md border border-input bg-transparent px-2 text-foreground tabular-nums"
      />
    </div>
  )
}
