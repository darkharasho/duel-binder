import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { LANGUAGES, languageInfo, type Language } from '@shared/languages'
import { RARITY_TIERS } from '@shared/scan/rarity'
import type { ScanWindowState } from '@shared/scanWindow'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { api, queryKeys } from '@/lib/api'
import { defaultEngine, type ScanEngine } from './engine'
import { InPageScanner, type InPageCamera } from './InPageScanner'
import { useScanHub } from './ScanHub'
import { NO_FINGERPRINTS, SET_UNREADABLE, statusText } from './scanText'
import { SessionList } from './SessionList'
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

interface PickedSet {
  setName: string
  language: Language
}

const setKeyOf = (s: PickedSet): string => `${s.language}|${s.setName}`

/**
 * Desktop only. With the scan window closed the page scans in place (camera preview, status,
 * list); with it open the page is the list and controls, and the window does the scanning.
 */
export function ScanPage({
  engineFactory = defaultEngine
}: {
  engineFactory?: () => ScanEngine
}): React.JSX.Element {
  const hub = useScanHub()
  const { settings, setSettings, state, open, openKnown } = hub
  const picked = settings.set
  const [local, setLocal] = useState<InPageCamera | null>(null)
  // Set from the click until the window reports open: the page camera is released first.
  const [handingOff, setHandingOff] = useState(false)
  const inPage = openKnown && !open && !handingOff

  // Once the window is open the handoff is over, so closing it brings the scanner back.
  if (open && handingOff) setHandingOff(false)
  // After the commit that unmounted the in-page scanner, so its camera is already stopped.
  useEffect(() => {
    if (!handingOff) return
    hub.openWindow().catch(() => setHandingOff(false))
    // Only when the handoff starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handingOff])

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
    if (inPage) local?.retry()
    else if (deviceId === settings.deviceId) hub.retryCamera()
  }

  const devices = inPage ? (local?.devices ?? []) : (state?.devices ?? [])
  const openCamera = inPage ? (local?.openDeviceId ?? '') : (state?.openDeviceId ?? null)
  const cameraError = inPage ? (local?.error ?? null) : (state?.cameraError ?? null)
  // Shown as picked only when it's one of the listed cameras (ids are blank before permission),
  // and not while the camera is in error, so picking it again reopens it.
  const activeCamera =
    (inPage || state) && !cameraError && devices.some((d) => d.deviceId === openCamera)
      ? (openCamera ?? '')
      : ''

  if (!openKnown) return <div className="p-8" />

  const newScansAs = (
    <>
      <span className="text-sm text-muted-foreground">New scans as</span>
      <SearchPicker
        label="New scans as"
        value={settings.defaultRarity ?? AUTO}
        options={RARITY_OPTIONS}
        onPick={pickRarity}
        searchPlaceholder="Search rarities…"
        className="w-48"
      />
    </>
  )
  const hitPrice = (
    <HitPriceInput value={settings.hitPrice} onCommit={(hitPrice) => setSettings({ hitPrice })} />
  )

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
            disabled={(!inPage && !open) || devices.length === 0}
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

      {inPage ? (
        <div className="mt-6 flex gap-6">
          <InPageScanner
            engineFactory={engineFactory}
            onCamera={setLocal}
            controls={
              <div className="flex flex-wrap items-center gap-3">
                {newScansAs}
                {hitPrice}
                <Button
                  variant="outline"
                  size="sm"
                  className="ml-auto"
                  onClick={() => setHandingOff(true)}
                >
                  Open scan window
                </Button>
              </div>
            }
          />
          <SessionList className="h-[calc(100vh-15rem)] flex-1" />
        </div>
      ) : (
        <>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Button variant="outline" size="sm" onClick={() => void hub.openWindow().catch(() => undefined)}>
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
            <span className="ml-3" />
            {newScansAs}
            {hitPrice}
          </div>

          <div className="mt-3 flex flex-col gap-1 text-sm">
            {!open ? (
              <p className="text-muted-foreground">Opening the scan window…</p>
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

          <SessionList className="mt-6 h-[calc(100vh-17rem)]" />
        </>
      )}
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
