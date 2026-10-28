import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { Language } from '@shared/languages'
import { isToScanWindow, type ScanWindowSettings, type ScanWindowState } from '@shared/scanWindow'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { defaultEngine, type ScanEngine } from '../engine'
import type { ScanDraft } from '../resolve'
import { useCamera } from '../useCamera'
import { useScanLoop } from '../useScanLoop'
import { createOutbox, type Outbox } from './outbox'
import { pullOf } from './overlay'
import { PullOverlay } from './PullOverlay'
import { useOverlay } from './useOverlay'

const WINDOW_TITLE = 'Duel Binder — Scan'
const ANY = 'any'
/** How often pulls the main window hasn't acknowledged are sent again. */
const RESEND_MS = 2000

const sendDraft = (id: string, draft: ScanDraft): void =>
  window.api.scanWindow.send({ kind: 'draft', id, draft })

/** Sends every pull still waiting for its acknowledgement. */
const flush = (outbox: Outbox): void => {
  for (const { id, draft } of outbox.pending()) sendDraft(id, draft)
}

function Scanner({
  settings,
  engineFactory,
  outbox
}: {
  settings: ScanWindowSettings
  engineFactory: () => ScanEngine
  outbox: Outbox
}): React.JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null)
  const camera = useCamera(settings.deviceId)
  const { overlay, push, clear } = useOverlay()
  const pulls = useRef(0)
  const hitPrice = useRef(settings.hitPrice)
  useEffect(() => {
    hitPrice.current = settings.hitPrice
  })

  const picked = settings.set
  const setPrintings = useQuery({
    queryKey: ['scan', 'setPrintings', picked?.setName, picked?.language as Language | undefined],
    queryFn: () => api.scan.printingsForSet(picked!.setName, picked!.language),
    enabled: picked !== null,
    staleTime: Infinity,
    refetchOnWindowFocus: false
  })
  // A set whose printings can't be read scans as any set rather than not at all.
  const setUnreadable = picked !== null && setPrintings.isError
  const scanSet = setUnreadable ? null : picked

  const onDraft = useCallback(
    (draft: ScanDraft) => {
      sendDraft(outbox.put(draft), draft)
      push(pullOf(draft, hitPrice.current, pulls.current++))
    },
    [push, outbox]
  )
  const loop = useScanLoop({
    videoRef,
    engineFactory,
    running: camera.stream !== null && !settings.paused,
    setName: scanSet?.setName ?? null,
    setKey: scanSet ? `${scanSet.language}|${scanSet.setName}` : ANY,
    setPrintings: scanSet === null ? null : setPrintings.data,
    defaultRarity: settings.defaultRarity,
    onDraft,
    onStalled: camera.retry
  })

  useEffect(() => {
    if (settings.paused) clear()
  }, [settings.paused, clear])

  const { retry: retryCamera } = camera
  const { retry: retryScan } = loop
  useEffect(
    () =>
      window.api.scanWindow.onMessage((m) => {
        if (!isToScanWindow(m)) return
        if (m.kind === 'retryCamera') retryCamera()
        else if (m.kind === 'retryScan') retryScan()
      }),
    [retryCamera, retryScan]
  )

  useEffect(() => {
    const video = videoRef.current
    if (video) video.srcObject = camera.stream
  }, [camera.stream])

  const state: ScanWindowState = {
    devices: camera.devices.map((d) => ({ deviceId: d.deviceId, label: d.label })),
    openDeviceId: camera.stream?.getVideoTracks()[0]?.getSettings().deviceId ?? null,
    cameraError: camera.error,
    loop: loop.status,
    artReady: loop.artReady,
    setUnreadable
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
      <PullOverlay pull={overlay} />
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
 * overlays, with no app UI. It does nothing until the main window sends its settings.
 */
export function ScanWindowApp({
  engineFactory = defaultEngine
}: {
  engineFactory?: () => ScanEngine
}): React.JSX.Element {
  const [settings, setSettings] = useState<ScanWindowSettings | null>(null)
  const [outbox] = useState(createOutbox)

  useEffect(() => {
    document.title = WINDOW_TITLE
    const off = window.api.scanWindow.onMessage((m) => {
      if (!isToScanWindow(m)) return
      if (m.kind === 'ack') outbox.ack(m.id)
      else if (m.kind === 'settings') {
        setSettings(m.settings)
        // Settings mean the hub is listening: pulls left from before it (re)loaded, or from a
        // scan window that closed or crashed with them unacknowledged, go now.
        flush(outbox)
      }
    })
    const resend = setInterval(() => flush(outbox), RESEND_MS)
    window.api.scanWindow.send({ kind: 'ready' })
    return () => {
      off()
      clearInterval(resend)
    }
  }, [outbox])

  if (settings === null) return <div className="absolute inset-0 bg-black" />
  return <Scanner settings={settings} engineFactory={engineFactory} outbox={outbox} />
}
