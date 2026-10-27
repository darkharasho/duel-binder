import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { Language } from '@shared/languages'
import { isToScanWindow, type ScanWindowSettings, type ScanWindowState } from '@shared/scanWindow'
import { api } from '@/lib/api'
import { defaultEngine, type ScanEngine } from '../engine'
import type { ScanDraft } from '../resolve'
import { useCamera } from '../useCamera'
import { useScanLoop } from '../useScanLoop'
import { outlineInVideo, pullOf } from './overlay'
import { PullOverlay } from './PullOverlay'
import { useOverlay } from './useOverlay'

const WINDOW_TITLE = 'Duel Binder — Scan'
const ANY = 'any'

function Scanner({
  settings,
  engineFactory
}: {
  settings: ScanWindowSettings
  engineFactory: () => ScanEngine
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
      window.api.scanWindow.send({ kind: 'draft', draft })
      push(pullOf(draft, hitPrice.current, pulls.current++))
    },
    [push]
  )
  const loop = useScanLoop({
    videoRef,
    engineFactory,
    running: camera.stream !== null && !settings.paused,
    setName: scanSet?.setName ?? null,
    setKey: scanSet ? `${scanSet.language}|${scanSet.setName}` : ANY,
    setPrintings: scanSet === null ? null : setPrintings.data,
    defaultRarity: settings.defaultRarity,
    onDraft
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
  useEffect(() => {
    window.api.scanWindow.send({ kind: 'state', state: JSON.parse(serialized) as ScanWindowState })
  }, [serialized])

  // The outline in video pixels, worked out when the loop reports one (the video's size is only
  // known from the element).
  const loopOutline = loop.outline
  const [drawn, setDrawn] = useState<{
    points: [number, number][]
    width: number
    height: number
  } | null>(null)
  useEffect(() => {
    const video = videoRef.current
    setDrawn(
      loopOutline && video
        ? {
            points: outlineInVideo(loopOutline, video.videoWidth, video.videoHeight),
            width: video.videoWidth,
            height: video.videoHeight
          }
        : null
    )
  }, [loopOutline])

  if (camera.error) return <CameraNotAvailable />
  return (
    <div
      className="absolute inset-0 bg-black"
      onDoubleClick={() => void window.api.scanWindow.toggleFullScreen()}
    >
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        className="size-full object-cover object-center"
      />
      {drawn && (
        <svg
          aria-hidden
          viewBox={`0 0 ${drawn.width} ${drawn.height}`}
          preserveAspectRatio="xMidYMid slice"
          className="pointer-events-none absolute inset-0 size-full"
        >
          <polygon
            points={drawn.points.map(([x, y]) => `${x},${y}`).join(' ')}
            fill="none"
            stroke="#34d399"
            strokeWidth={3}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      )}
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
 * The scan window's whole page: the camera, the recognition loop, the outline and the pull
 * overlays, with no app UI. It does nothing until the main window sends its settings.
 */
export function ScanWindowApp({
  engineFactory = defaultEngine
}: {
  engineFactory?: () => ScanEngine
}): React.JSX.Element {
  const [settings, setSettings] = useState<ScanWindowSettings | null>(null)

  useEffect(() => {
    document.title = WINDOW_TITLE
    const off = window.api.scanWindow.onMessage((m) => {
      if (isToScanWindow(m) && m.kind === 'settings') setSettings(m.settings)
    })
    window.api.scanWindow.send({ kind: 'ready' })
    return off
  }, [])

  if (settings === null) return <div className="absolute inset-0 bg-black" />
  return <Scanner settings={settings} engineFactory={engineFactory} />
}
