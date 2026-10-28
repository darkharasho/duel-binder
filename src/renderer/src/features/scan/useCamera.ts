import { useCallback, useEffect, useRef, useState } from 'react'

/** `busy`: the camera is there but held by something else (another app, or the other scanner). */
export type CameraError = 'denied' | 'none' | 'lost' | 'busy'

/** Waits before each automatic retry of a busy camera; after the last, Try again is up to the user. */
const BUSY_RETRY_MS = [500, 1500, 4000]

const CAMERA_KEY = 'scan.camera'

/** The camera picked last time, if any. */
export function rememberedCamera(): string | null {
  try {
    return localStorage.getItem(CAMERA_KEY)
  } catch {
    return null
  }
}

function remember(deviceId: string): void {
  try {
    localStorage.setItem(CAMERA_KEY, deviceId)
  } catch {
    // Unavailable storage only costs the remembered choice.
  }
}

const stop = (s: MediaStream): void => s.getTracks().forEach((t) => t.stop())

/** Which way the camera should face when no device is picked: the phone's rear camera. */
export type CameraFacing = 'environment'

const constraints = (deviceId: string | null, facing?: CameraFacing): MediaStreamConstraints => ({
  audio: false,
  video: {
    // 4K where the camera has it (a held card's set code is then about 14 px tall, not 7);
    // being ideal, not min, any lower resolution still opens.
    width: { ideal: 3840 },
    height: { ideal: 2160 },
    ...(deviceId
      ? { deviceId: { exact: deviceId } }
      : facing
        ? { facingMode: { ideal: facing } }
        : {})
  }
})

const errorOf = (e: unknown): CameraError => {
  const name = e instanceof Error || e instanceof DOMException ? e.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied'
  // Chromium's names for a device another process (or window) still holds.
  if (name === 'NotReadableError' || name === 'AbortError' || name === 'TrackStartError')
    return 'busy'
  return 'none'
}

/**
 * The webcam stream for deviceId (null: the system default), at up to 3840x2160, and the
 * webcams there are. A device that opens is remembered for next time. `lost` means the stream
 * ended on its own (unplugged); `retry` opens the camera again. With `facing` and no deviceId,
 * it asks for the camera facing that way (the phone's rear camera); desktop passes none.
 *
 * It recovers on its own where it can: a busy camera is tried again a few times, a missing or
 * lost one again when a device is plugged in, and a stream the system ended or muted while the
 * app was in the background (phones, sleep) is reopened when the app is shown again.
 */
export function useCamera(
  deviceId: string | null,
  facing?: CameraFacing
): {
  stream: MediaStream | null
  devices: MediaDeviceInfo[]
  error: CameraError | null
  retry: () => void
} {
  const [attempt, setAttempt] = useState(0)
  const key = `${deviceId ?? ''}#${facing ?? ''}#${attempt}`
  // Results are tagged with the request they answer, so a new request starts out empty.
  const [opened, setOpened] = useState<{
    key: string
    stream: MediaStream | null
    error: CameraError | null
  } | null>(null)
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const supported = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
  const current = opened?.key === key ? opened : null
  const stream = current?.stream ?? null
  const error: CameraError | null = supported ? (current?.error ?? null) : 'none'
  const retry = useCallback(() => setAttempt((n) => n + 1), [])
  // For the device and visibility listeners, which outlive a render.
  const now = useRef({ stream, error })
  useEffect(() => {
    now.current = { stream, error }
  })

  useEffect(() => {
    const media = navigator.mediaDevices
    if (!media?.enumerateDevices) return
    let live = true
    const list = (): void => {
      media
        .enumerateDevices()
        .then((all) => {
          if (live) setDevices(all.filter((d) => d.kind === 'videoinput'))
        })
        .catch(() => undefined)
    }
    const changed = (): void => {
      list()
      // A camera plugged (back) in: try it, unless the user has said no.
      const e = now.current.error
      if (e === 'lost' || e === 'none' || e === 'busy') retry()
    }
    list()
    media.addEventListener?.('devicechange', changed)
    return () => {
      live = false
      media.removeEventListener?.('devicechange', changed)
    }
  }, [stream, retry])

  // A busy camera is often freed a moment later (the other scanner letting go of it).
  const busyTries = useRef(0)
  useEffect(() => {
    if (stream) busyTries.current = 0
    if (error !== 'busy' || busyTries.current >= BUSY_RETRY_MS.length) return
    const timer = setTimeout(retry, BUSY_RETRY_MS[busyTries.current++])
    return () => clearTimeout(timer)
  }, [error, stream, retry])

  // Back from the background or sleep: a stream ended or muted meanwhile is opened again.
  useEffect(() => {
    if (typeof document === 'undefined') return
    const shown = (): void => {
      if (document.visibilityState !== 'visible') return
      const { stream: s, error: e } = now.current
      const track = s?.getVideoTracks()[0]
      if (e === 'lost' || (track && (track.readyState === 'ended' || track.muted))) retry()
    }
    document.addEventListener('visibilitychange', shown)
    return () => document.removeEventListener('visibilitychange', shown)
  }, [retry])

  useEffect(() => {
    const media = navigator.mediaDevices
    if (!media?.getUserMedia) return
    let live = true
    let current: MediaStream | null = null
    const open = async (): Promise<MediaStream> => {
      try {
        return await media.getUserMedia(constraints(deviceId, facing))
      } catch (e) {
        // A remembered camera that's gone: fall back to the default one.
        if (deviceId && e instanceof DOMException && e.name === 'OverconstrainedError')
          return media.getUserMedia(constraints(null, facing))
        throw e
      }
    }
    open()
      .then((s) => {
        if (!live) return stop(s)
        current = s
        const track = s.getVideoTracks()[0]
        track?.addEventListener('ended', () => {
          if (live) setOpened({ key, stream: null, error: 'lost' })
        })
        const id = track?.getSettings().deviceId
        if (id) remember(id)
        setOpened({ key, stream: s, error: null })
      })
      .catch((e: unknown) => {
        if (live) setOpened({ key, stream: null, error: errorOf(e) })
      })
    return () => {
      live = false
      if (current) stop(current)
    }
  }, [deviceId, facing, key])

  return { stream, devices, error, retry }
}
