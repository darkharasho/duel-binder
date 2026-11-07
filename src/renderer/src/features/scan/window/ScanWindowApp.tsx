import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { GameId } from '@shared/games/types'
import type { TiltModel } from '@shared/scan/tilt'
import { TILT_MODELS } from '@shared/scan/tiltModel'
import { liveLanguage } from '@shared/scanWindow'
import { printedLanguage, useLanguageFilter } from '@/lib/languageFilter'
import {
  isToScanWindow,
  type ScanSummary,
  type ScanWindowSettings,
  type ScanWindowState
} from '@shared/scanWindow'
import { api } from '@/lib/api'
import { GameProvider, useGame } from '@/lib/game'
import { playScanPing } from '@/lib/scanPing'
import { cn } from '@/lib/utils'
import { defaultEngine, type EngineFactory } from '../engine'
import type { ScanDraft } from '../resolve'
import { cameraResolution, useCamera } from '../useCamera'
import { useScanSets } from '../setPrintings'
import { useScanLoop } from '../useScanLoop'
import { createOutbox, type Outbox } from './outbox'
import { pullOf } from './overlay'
import { PullOverlay } from './PullOverlay'
import { SummaryOverlay } from './SummaryScreen'
import { useOverlay } from './useOverlay'

const WINDOW_TITLE = 'Duel Binder — Scan'
/** How often pulls the main window hasn't acknowledged are sent again. */
const RESEND_MS = 2000

const sendDraft = (id: string, draft: ScanDraft): void =>
  window.api.scanWindow.send({ kind: 'draft', id, draft })

/** Background rarity reads by draft id, until the hub acknowledges them. Memory only. */
type Rereads = Map<string, ScanDraft>

const sendReread = (id: string, draft: ScanDraft): void =>
  window.api.scanWindow.send({ kind: 'rarity', id, draft })

/**
 * Sends every pull still waiting for its acknowledgement, and every rarity read whose pull the
 * hub has acknowledged (a read for a pull it hasn't counted yet has no row to land on).
 */
const flush = (outbox: Outbox, rereads: Rereads): void => {
  const pending = outbox.pending()
  for (const { id, draft } of pending) sendDraft(id, draft)
  for (const [id, draft] of rereads) {
    if (!pending.some((e) => e.id === id)) sendReread(id, draft)
  }
}

/** The window's size as a capture sees it, kept current as it's dragged or moved between displays. */
function useCapturePixels(): { width: number; height: number } {
  const read = (): { width: number; height: number } => ({
    width: Math.round(window.innerWidth * window.devicePixelRatio),
    height: Math.round(window.innerHeight * window.devicePixelRatio)
  })
  const [size, setSize] = useState(read)
  useEffect(() => {
    const update = (): void => setSize(read())
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])
  return size
}

type TiltModels = Partial<Record<GameId, TiltModel>>

function Scanner({
  settings,
  engineFactory,
  tiltModels,
  outbox,
  rereads
}: {
  settings: ScanWindowSettings
  engineFactory: EngineFactory
  tiltModels: TiltModels
  outbox: Outbox
  rereads: Rereads
}): React.JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null)
  const { game } = useGame()
  const camera = useCamera(settings.deviceId)
  const { overlay, push, clear } = useOverlay()
  const [scanned, setScanned] = useState<Readonly<Record<string, number>>>({})
  const pulls = useRef(0)
  const hitPrice = useRef(settings.hitPrice)
  useEffect(() => {
    hitPrice.current = settings.hitPrice
  })

  const queryClient = useQueryClient()
  const { setKey, setPrintings, setUnreadable, setsSkipped } = useScanSets(settings.sets)
  // Staleness is infinite, so printings are only re-read when a background sync changes data
  // (a price that arrives after the card was first scanned must show).
  useEffect(
    () =>
      api.app.onDataChanged(() => {
        void queryClient.invalidateQueries({ queryKey: ['scan'] })
      }),
    [queryClient]
  )
  const onDraft = useCallback(
    (draft: ScanDraft): string => {
      const id = outbox.put(draft)
      sendDraft(id, draft)
      push({ ...pullOf(draft, hitPrice.current, pulls.current++), id })
      playScanPing()
      return id
    },
    [push, outbox]
  )
  const onRarityRead = useCallback(
    (id: string, draft: ScanDraft): void => {
      rereads.set(id, draft)
      // Held until the pull is acknowledged; the resend timer sends it then.
      if (!outbox.pending().some((e) => e.id === id)) sendReread(id, draft)
    },
    [outbox, rereads]
  )
  const [filter] = useLanguageFilter()
  const loop = useScanLoop({
    videoRef,
    engineFactory,
    game,
    running: camera.stream !== null && !settings.paused,
    setKey,
    setPrintings,
    defaultRarity: settings.defaultRarity,
    language: game === 'pkm' ? liveLanguage(settings) : null,
    filterLanguage: game === 'ygo' || game === 'op' ? printedLanguage(filter) : null,
    tiltModels,
    onDraft,
    onRarityRead,
    onStalled: camera.retry,
    wholeFrame: true
  })

  useEffect(() => {
    if (settings.paused) clear()
  }, [settings.paused, clear])

  const { retry: retryCamera } = camera
  const { retry: retryScan, takePhoto } = loop
  useEffect(
    () =>
      window.api.scanWindow.onMessage((m) => {
        if (!isToScanWindow(m)) return
        if (m.kind === 'ack') setScanned((s) => ({ ...s, [m.id]: m.scanned }))
        else if (m.kind === 'retryCamera') retryCamera()
        else if (m.kind === 'retryScan') retryScan()
        else if (m.kind === 'takePhoto') takePhoto()
      }),
    [retryCamera, retryScan, takePhoto]
  )

  useEffect(() => {
    const video = videoRef.current
    if (video) video.srcObject = camera.stream
  }, [camera.stream])

  const size = useCapturePixels()
  const state: ScanWindowState = {
    devices: camera.devices.map((d) => ({ deviceId: d.deviceId, label: d.label })),
    openDeviceId: camera.stream?.getVideoTracks()[0]?.getSettings().deviceId ?? null,
    resolution: cameraResolution(camera.stream),
    cameraError: camera.error,
    loop: loop.status,
    artReady: loop.artReady,
    artData: loop.artData,
    setUnreadable,
    setsSkipped,
    size
  }
  const serialized = JSON.stringify(state)
  // Sent when it changes, and again with every settings message, so a main window that reloaded
  // or remounted its hub after the last send still learns it.
  useEffect(() => {
    window.api.scanWindow.send({ kind: 'state', state: JSON.parse(serialized) as ScanWindowState })
  }, [serialized, settings])

  if (camera.error) return <CameraNotAvailable />
  return (
    <div
      className="absolute inset-0 overflow-hidden bg-black"
      onDoubleClick={() => void window.api.scanWindow.toggleFullScreen()}
    >
      {/* The zoom only changes what the window shows; recognition still reads the whole frame. */}
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        className={cn(
          'size-full object-center',
          settings.fit === 'whole' ? 'object-contain' : 'object-cover'
        )}
        style={settings.zoom > 1 ? { transform: `scale(${settings.zoom})` } : undefined}
      />
      <PullOverlay pull={overlay} scanned={scanned} />
    </div>
  )
}

function CameraNotAvailable(): React.JSX.Element {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-neutral-950 text-[clamp(1rem,2.4vw,2rem)] text-white/60">
      Camera not available
    </div>
  )
}

/**
 * The scan window's whole page: the camera, the recognition loop and the pull
 * overlays, with no app UI. It does nothing until the main window sends its settings, and scans
 * the game the main window shows: read as the main window reads it, again whenever main says the
 * data changed (as it does after a switch), and nothing is scanned before it's known.
 */
export function ScanWindowApp({
  engineFactory = defaultEngine,
  tiltModels = TILT_MODELS
}: {
  engineFactory?: EngineFactory
  /** The tilt models by game; tests pass their own. */
  tiltModels?: TiltModels
}): React.JSX.Element {
  const [settings, setSettings] = useState<ScanWindowSettings | null>(null)
  const [summary, setSummary] = useState<ScanSummary | null>(null)
  const [outbox] = useState(createOutbox)
  const [rereads] = useState<Rereads>(() => new Map())

  useEffect(() => {
    document.title = WINDOW_TITLE
    const off = window.api.scanWindow.onMessage((m) => {
      if (!isToScanWindow(m)) return
      if (m.kind === 'ack') outbox.ack(m.id)
      else if (m.kind === 'rarityAck') rereads.delete(m.id)
      else if (m.kind === 'summary') setSummary(m.summary)
      else if (m.kind === 'settings') {
        setSettings(m.settings)
        // Settings mean the hub is listening: pulls left from before it (re)loaded, or from a
        // scan window that closed or crashed with them unacknowledged, go now.
        flush(outbox, rereads)
      }
    })
    const resend = setInterval(() => flush(outbox, rereads), RESEND_MS)
    window.api.scanWindow.send({ kind: 'ready' })
    return () => {
      off()
      clearInterval(resend)
    }
  }, [outbox, rereads])

  const black = <div className="absolute inset-0 bg-black" />
  if (settings === null) return black
  return (
    <GameProvider fallback={black}>
      <Scanner
        settings={settings}
        engineFactory={engineFactory}
        tiltModels={tiltModels}
        outbox={outbox}
        rereads={rereads}
      />
      <SummaryOverlay summary={summary} />
    </GameProvider>
  )
}
