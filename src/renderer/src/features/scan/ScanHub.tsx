import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { isLanguage } from '@shared/languages'
import { RARITY_TIERS } from '@shared/scan/rarity'
import { isFromScanWindow, type ScanWindowSettings, type ScanWindowState } from '@shared/scanWindow'
import type { ScanDraft } from './resolve'
import { rowKey, useScanSession } from './session'
import { rememberedCamera } from './useCamera'

const SET_KEY = 'scan.set'
const RARITY_KEY = 'scan.defaultRarity'
const HIT_PRICE_KEY = 'scan.hitPrice'
const DEFAULT_HIT_PRICE = 20
const HIGHLIGHT_MS = 1500

export interface ScanHub {
  session: ReturnType<typeof useScanSession>
  /** The row last counted, for 1.5 s, to highlight. */
  fresh: string | null
  open: boolean
  /** False until the app has learnt whether the scan window is already open. */
  openKnown: boolean
  /** Last state the open scan window reported; null while closed or before it reports. */
  state: ScanWindowState | null
  settings: ScanWindowSettings
  setSettings(patch: Partial<ScanWindowSettings>): void
  /** Counts a pull onto the list and highlights its row; the one path for both scanners. */
  count(draft: ScanDraft): void
  openWindow(): Promise<void>
  retryCamera(): void
  retryScan(): void
}

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

const parseSet = (raw: string): ScanWindowSettings['set'] => {
  const v = JSON.parse(raw) as { setName?: unknown; language?: unknown }
  return typeof v.setName === 'string' && isLanguage(v.language)
    ? { setName: v.setName, language: v.language }
    : null
}

const parseHitPrice = (raw: string): number | null => {
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : null
}

const initialSettings = (): ScanWindowSettings => ({
  deviceId: rememberedCamera(),
  paused: false,
  set: read(SET_KEY, parseSet),
  defaultRarity: read(RARITY_KEY, (r) => (RARITY_TIERS.includes(r) ? r : null)),
  hitPrice: read(HIT_PRICE_KEY, parseHitPrice) ?? DEFAULT_HIT_PRICE
})

const HubContext = createContext<ScanHub | null>(null)

/**
 * Desktop only. Lives above the pages, so pulls the scan window reports land on the list even
 * while the Scan page isn't showing, and the window is told the settings however it came up.
 */
export function ScanHubProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const session = useScanSession()
  const [settings, setSettingsState] = useState<ScanWindowSettings>(initialSettings)
  const settingsRef = useRef(settings)
  const [open, setOpen] = useState(false)
  const [openKnown, setOpenKnown] = useState(false)
  const [state, setState] = useState<ScanWindowState | null>(null)
  const [fresh, setFresh] = useState<string | null>(null)
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const { add } = session

  const count = useCallback(
    (draft: ScanDraft): void => {
      add(draft)
      setFresh(rowKey(draft))
      clearTimeout(highlightTimer.current)
      highlightTimer.current = setTimeout(() => setFresh(null), HIGHLIGHT_MS)
    },
    [add]
  )

  const sendSettings = useCallback((): void => {
    window.api.scanWindow.send({ kind: 'settings', settings: settingsRef.current })
  }, [])

  const setSettings = useCallback(
    (patch: Partial<ScanWindowSettings>): void => {
      const next = { ...settingsRef.current, ...patch }
      settingsRef.current = next
      if ('set' in patch) write(SET_KEY, next.set ? JSON.stringify(next.set) : null)
      if ('defaultRarity' in patch) write(RARITY_KEY, next.defaultRarity)
      if ('hitPrice' in patch) write(HIT_PRICE_KEY, String(next.hitPrice))
      setSettingsState(next)
      // Sent now, not from an effect, so a retry sent right after reaches the window after it.
      // Main drops it while no window is open.
      sendSettings()
    },
    [sendSettings]
  )

  useEffect(() => {
    let live = true
    const scanWindow = window.api.scanWindow
    // If main can't say, treat the window as closed so the page still gets its scanner.
    void scanWindow.isOpen().then(
      (isOpen) => {
        if (!live) return
        setOpenKnown(true)
        if (!isOpen) return
        setOpen(true)
        sendSettings()
      },
      () => {
        if (live) setOpenKnown(true)
      }
    )
    const offOpen = scanWindow.onOpenChange((isOpen) => {
      setOpenKnown(true)
      setOpen(isOpen)
      if (isOpen) sendSettings()
      else {
        setState(null)
        setSettings({ paused: false })
      }
    })
    const offMessage = scanWindow.onMessage((m) => {
      if (!isFromScanWindow(m)) return
      if (m.kind === 'ready') sendSettings()
      else if (m.kind === 'state') setState(m.state)
      else count(m.draft)
    })
    return () => {
      live = false
      offOpen()
      offMessage()
      clearTimeout(highlightTimer.current)
    }
  }, [count, sendSettings, setSettings])

  const hub = useMemo<ScanHub>(
    () => ({
      session,
      fresh,
      open,
      openKnown,
      state,
      settings,
      setSettings,
      count,
      openWindow: () => window.api.scanWindow.open(),
      retryCamera: () => window.api.scanWindow.send({ kind: 'retryCamera' }),
      retryScan: () => window.api.scanWindow.send({ kind: 'retryScan' })
    }),
    [session, fresh, open, openKnown, state, settings, setSettings, count]
  )
  return <HubContext.Provider value={hub}>{children}</HubContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components -- the hook belongs with its provider
export function useScanHub(): ScanHub {
  const hub = useContext(HubContext)
  if (!hub) throw new Error('useScanHub needs a ScanHubProvider')
  return hub
}
