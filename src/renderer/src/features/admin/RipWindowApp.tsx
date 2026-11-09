import { useEffect, useRef, useState } from 'react'
import { isToRipWindow, type RipWindowState } from '@shared/ripWindow'
import { cameraResolution, useCamera } from '../scan/useCamera'
import { useRipCapture } from './useRipCapture'

const WINDOW_TITLE = 'Duel Binder — Rip capture'

/**
 * The rip window's whole page (#rip): the camera filling the window, nothing over it, so it can
 * be shared on a stream. It runs the capture; the Admin Rip capture tab drives it and lists the
 * frames. Double-click or F11 for full screen; Space keeps the frame on screen.
 */
export function RipWindowApp(): React.JSX.Element {
  const [deviceId, setDeviceId] = useState<string | null>(null)
  const camera = useCamera(deviceId, undefined, { remember: false, off: deviceId === null })
  const video = useRef<HTMLVideoElement>(null)
  const send = window.api.ripWindow.send
  const capture = useRipCapture(video, camera.stream, {
    onFrame: (frame) => send({ kind: 'frame', frame }),
    onRemoved: (name) => send({ kind: 'removed', name })
  })

  useEffect(() => {
    if (video.current) video.current.srcObject = camera.stream
  }, [camera.stream])

  // The tab's commands; a ref so the listener, set up once, sees the current capture.
  const now = useRef({ capture, camera })
  useEffect(() => {
    now.current = { capture, camera }
  })
  const lastState = useRef('{}')
  useEffect(() => {
    document.title = WINDOW_TITLE
    const off = window.api.ripWindow.onMessage((m) => {
      if (!isToRipWindow(m)) return
      const { capture: c, camera: cam } = now.current
      if (m.kind === 'camera') {
        if (!c.session) setDeviceId(m.deviceId)
      } else if (m.kind === 'retryCamera') cam.retry()
      else if (m.kind === 'start') c.start(m.session)
      else if (m.kind === 'stop') c.stop()
      else if (m.kind === 'keep') void c.keepNow()
      else if (m.kind === 'remove') void c.remove(m.name)
      else if (m.kind === 'sync') {
        send({ kind: 'state', state: JSON.parse(lastState.current) as RipWindowState })
        send({ kind: 'frames', frames: c.frames })
      }
    })
    send({ kind: 'ready' })
    return off
  }, [send])

  useEffect(() => {
    if (!capture.session) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.code !== 'Space') return
      e.preventDefault()
      void now.current.capture.keepNow()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [capture.session])

  const track = camera.stream?.getVideoTracks()[0]
  const state: RipWindowState = {
    devices: camera.devices
      .filter((d) => d.deviceId)
      .map((d) => ({ deviceId: d.deviceId, label: d.label })),
    openDeviceId: track?.getSettings().deviceId ?? null,
    resolution: cameraResolution(camera.stream),
    cameraError: camera.error,
    session: capture.session,
    picker: capture.picker,
    error: capture.error
  }
  const serialized = JSON.stringify(state)
  useEffect(() => {
    lastState.current = serialized
    send({ kind: 'state', state: JSON.parse(serialized) as RipWindowState })
  }, [serialized, send])

  return (
    <div
      className="absolute inset-0 overflow-hidden bg-black"
      onDoubleClick={() => void window.api.ripWindow.toggleFullScreen()}
    >
      <video ref={video} autoPlay muted playsInline className="size-full object-contain" />
      {!camera.stream && (
        <div className="absolute inset-0 flex items-center justify-center text-[clamp(1rem,2.4vw,2rem)] text-white/60">
          {deviceId === null
            ? 'Pick a camera on the Rip capture tab'
            : camera.error
              ? 'Camera not available'
              : 'Opening the camera…'}
        </div>
      )}
    </div>
  )
}
