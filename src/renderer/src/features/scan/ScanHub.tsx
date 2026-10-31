import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { GameId } from '@shared/games/types'
import { isLanguage } from '@shared/languages'
import { RARITY_TIERS } from '@shared/scan/rarity'
import {
  SCAN_ZOOMS,
  isFromScanWindow,
  isPokemonLanguage,
  type ScanFit,
  type ScanWindowSettings,
  type ScanWindowState
} from '@shared/scanWindow'
import { api } from '@/lib/api'
import { unpricedIntl, useRequestPrices } from '@/lib/priceRequests'
import type { ScanDraft } from './resolve'
import { useScanSession } from './session'
import { rememberedCamera } from './useCamera'

/** Yu-Gi-Oh!'s keeps the key it always had, so an existing pick survives. */
const setKeyOf = (game: GameId): string => (game === 'ygo' ? 'scan.set' : `scan.set.${game}`)
const RARITY_KEY = 'scan.defaultRarity'
const LANGUAGE_KEY = 'scan.pokemonLanguage'
const HIT_PRICE_KEY = 'scan.hitPrice'
const FIT_KEY = 'scan.fit'
const ZOOM_KEY = 'scan.zoom'
const SEEN_KEY = 'scan.drafts.seen'
const DEFAULT_HIT_PRICE = 20
const HIGHLIGHT_MS = 1500
/** Ids of counted scan-window pulls kept, to drop resends; far more than are ever in flight. */
const MAX_SEEN = 500
/** Tries at asking main whether the scan window is open, and the wait between them. */
const IS_OPEN_TRIES = 3
const IS_OPEN_RETRY_MS = 500

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
  takePhoto(): void
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

const parseZoom = (raw: string): number | null => {
  const n = Number(raw)
  return (SCAN_ZOOMS as readonly number[]).includes(n) ? n : null
}

const initialSettings = (): ScanWindowSettings => ({
  deviceId: rememberedCamera(),
  paused: false,
  set: read(setKeyOf('ygo'), parseSet),
  scanLanguage: read(LANGUAGE_KEY, (l) => (isPokemonLanguage(l) ? l : null)) ?? 'en',
  defaultRarity: read(RARITY_KEY, (r) => (RARITY_TIERS.includes(r) ? r : null)),
  hitPrice: read(HIT_PRICE_KEY, parseHitPrice) ?? DEFAULT_HIT_PRICE,
  fit: read(FIT_KEY, (f): ScanFit | null => (f === 'whole' || f === 'fill' ? f : null)) ?? 'fill',
  zoom: read(ZOOM_KEY, parseZoom) ?? 1
})

/**
 * The scan-window pulls already counted. The window resends a pull until it's acknowledged, so
 * the same one can arrive twice; kept in storage so a resend after this window reloads is
 * dropped too.
 */
function createSeen(): { has(id: string): boolean; add(id: string): void } {
  let ids: string[] =
    read(SEEN_KEY, (raw) => {
      const v: unknown = JSON.parse(raw)
      return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : null
    }) ?? []
  return {
    has: (id) => ids.includes(id),
    add(id) {
      ids = [...ids, id].slice(-MAX_SEEN)
      write(SEEN_KEY, JSON.stringify(ids))
    }
  }
}

/** Asks main whether the scan window is open, a few times before giving up. */
async function askIsOpen(): Promise<boolean> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await window.api.scanWindow.isOpen()
    } catch (err) {
      if (attempt >= IS_OPEN_TRIES) throw err
      await new Promise((r) => setTimeout(r, IS_OPEN_RETRY_MS))
    }
  }
}

/**
 * The game shown, kept up as the app switches it. The hub sits above the pages (above the game
 * provider, on desktop), so it asks for itself, on the triggers the provider reads again on.
 */
function useActiveGame(): GameId {
  const [game, setGame] = useState<GameId>('ygo')
  useEffect(() => {
    let live = true
    let reads = 0
    const read = (): void => {
      const n = ++reads
      api.games.active().then(
        (g) => {
          if (live && n === reads) setGame(g === 'pkm' ? 'pkm' : 'ygo')
        },
        () => {
          // Unreadable: the game stays as it was.
        }
      )
    }
    read()
    const offData = api.app.onDataChanged(read)
    const offAccount = api.account.onChange(read)
    return () => {
      live = false
      offData()
      offAccount()
    }
  }, [])
  return game
}

const HubContext = createContext<ScanHub | null>(null)

/**
 * Desktop only. Lives above the pages, so pulls the scan window reports land on the list even
 * while the Scan page isn't showing, and the window is told the settings however it came up.
 */
export function ScanHubProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const game = useActiveGame()
  const session = useScanSession(game)
  const gameRef = useRef<GameId>('ygo')
  const [settings, setSettingsState] = useState<ScanWindowSettings>(initialSettings)
  const settingsRef = useRef(settings)
  const [open, setOpen] = useState(false)
  const [openKnown, setOpenKnown] = useState(false)
  const [state, setState] = useState<ScanWindowState | null>(null)
  const [fresh, setFresh] = useState<string | null>(null)
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [seen] = useState(createSeen)
  const { add, refreshPrices } = session

  // Unpriced non-English pulls on the list: ask for their prices, and fill them in as syncs bring them.
  useRequestPrices(
    unpricedIntl(
      session.rows.flatMap((r) => r.options.filter((o) => o.printingId === r.printingId))
    )
  )
  useEffect(
    () =>
      window.api.app.onDataChanged(() => {
        refreshPrices().catch(() => {
          // A failed read leaves the prices as they were; the next sync tries again.
        })
      }),
    [refreshPrices]
  )

  const count = useCallback(
    (draft: ScanDraft): void => {
      setFresh(add(draft))
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
      if ('set' in patch)
        write(setKeyOf(gameRef.current), next.set ? JSON.stringify(next.set) : null)
      if ('defaultRarity' in patch) write(RARITY_KEY, next.defaultRarity)
      if ('scanLanguage' in patch) write(LANGUAGE_KEY, next.scanLanguage)
      if ('hitPrice' in patch) write(HIT_PRICE_KEY, String(next.hitPrice))
      if ('fit' in patch) write(FIT_KEY, next.fit)
      if ('zoom' in patch) write(ZOOM_KEY, String(next.zoom))
      setSettingsState(next)
      // Sent now, not from an effect, so a retry sent right after reaches the window after it.
      // Main drops it while no window is open.
      sendSettings()
    },
    [sendSettings]
  )

  // Each game has its own picked set: a set of the other game would find nothing here.
  useEffect(() => {
    if (gameRef.current === game) return
    gameRef.current = game
    setSettings({ set: read(setKeyOf(game), parseSet) })
  }, [game, setSettings])

  useEffect(() => {
    let live = true
    const scanWindow = window.api.scanWindow
    // If main can't say, treat the window as closed so the page still gets its scanner; a
    // message from the window (below) still proves it open, so the two never both count.
    void askIsOpen().then(
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
      // Only an open scan window sends anything.
      setOpenKnown(true)
      setOpen(true)
      if (m.kind === 'ready') {
        // A window that (re)loaded, after a crash say, hasn't reported yet: what it said last is stale.
        setState(null)
        sendSettings()
      } else if (m.kind === 'state') setState(m.state)
      else {
        // A pull of the other game waits, unacknowledged (so the window sends it again), until
        // that game is the one shown.
        if ((m.draft.game ?? 'ygo') !== gameRef.current) return
        if (!seen.has(m.id)) {
          seen.add(m.id)
          count(m.draft)
        }
        // Acknowledged once it's on the list (saved there), and again for every resend.
        scanWindow.send({ kind: 'ack', id: m.id })
      }
    })
    return () => {
      live = false
      offOpen()
      offMessage()
      clearTimeout(highlightTimer.current)
    }
  }, [count, sendSettings, setSettings, seen])

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
      retryScan: () => window.api.scanWindow.send({ kind: 'retryScan' }),
      takePhoto: () => window.api.scanWindow.send({ kind: 'takePhoto' })
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
