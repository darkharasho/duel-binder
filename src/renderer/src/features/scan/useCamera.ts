import { useCallback, useEffect, useState } from 'react'

export type CameraError = 'denied' | 'none' | 'lost'

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

const constraints = (deviceId: string | null): MediaStreamConstraints => ({
  audio: false,
  video: {
    width: { ideal: 1920 },
    height: { ideal: 1080 },
    ...(deviceId ? { deviceId: { exact: deviceId } } : {})
  }
})

const errorOf = (e: unknown): CameraError => {
  const name = e instanceof Error || e instanceof DOMException ? e.name : ''
  return name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'none'
}

/**
 * The webcam stream for deviceId (null: the system default), at up to 1920x1080, and the
 * webcams there are. A device that opens is remembered for next time. `lost` means the stream
 * ended on its own (unplugged); `retry` opens the camera again.
 */
export function useCamera(deviceId: string | null): {
  stream: MediaStream | null
  devices: MediaDeviceInfo[]
  error: CameraError | null
  retry: () => void
} {
  const [attempt, setAttempt] = useState(0)
  const key = `${deviceId ?? ''}#${attempt}`
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
    list()
    media.addEventListener?.('devicechange', list)
    return () => {
      live = false
      media.removeEventListener?.('devicechange', list)
    }
  }, [stream])

  useEffect(() => {
    const media = navigator.mediaDevices
    if (!media?.getUserMedia) return
    let live = true
    let current: MediaStream | null = null
    const open = async (): Promise<MediaStream> => {
      try {
        return await media.getUserMedia(constraints(deviceId))
      } catch (e) {
        // A remembered camera that's gone: fall back to the default one.
        if (deviceId && e instanceof DOMException && e.name === 'OverconstrainedError')
          return media.getUserMedia(constraints(null))
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
  }, [deviceId, key])

  const retry = useCallback(() => setAttempt((n) => n + 1), [])
  return { stream, devices, error, retry }
}
