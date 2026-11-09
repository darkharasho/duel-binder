import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import {
  isFromRipWindow,
  type RipFrame,
  type RipPickerState,
  type RipWindowState
} from '@shared/ripWindow'
import { resolutionText } from '@shared/scanWindow'
import { cameraResolution, useCamera } from '../scan/useCamera'
import { errorText } from './adminTabs'
import { Note, Panel } from './parts'
import { sessionName, useRipCapture, type RipCapture } from './useRipCapture'

const CAMERA_KEY = 'admin.ripCapture.camera'

function storedCamera(): string | null {
  try {
    return localStorage.getItem(CAMERA_KEY)
  } catch {
    return null
  }
}

/**
 * The rip window, while it's open: it has the camera and runs the capture, and this tab drives
 * it. Null while it's closed (or this isn't the desktop app).
 */
function useRipWindow(deviceId: string | null): {
  remote: (RipCapture & { state: RipWindowState | null }) | null
  /** The window's last session's frames, still listed after it closes. */
  frames: RipFrame[]
} {
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<RipWindowState | null>(null)
  const [frames, setFrames] = useState<RipFrame[]>([])
  const rip = api.ripWindow
  const device = useRef(deviceId)
  useEffect(() => {
    device.current = deviceId
  })

  useEffect(() => {
    if (!rip) return
    let live = true
    const hello = (): void => {
      rip.send({ kind: 'camera', deviceId: device.current })
      rip.send({ kind: 'sync' })
    }
    void rip.isOpen().then((o) => {
      if (!live) return
      setOpen(o)
      if (o) hello()
    })
    const offOpen = rip.onOpenChange((o) => {
      setOpen(o)
      if (!o) setState(null)
    })
    const offMessage = rip.onMessage((m) => {
      if (!isFromRipWindow(m)) return
      if (m.kind === 'ready') hello()
      else if (m.kind === 'state')
        setState((prev) => {
          // A new session starts an empty list.
          if (m.state.session && m.state.session !== prev?.session) setFrames([])
          return m.state
        })
      else if (m.kind === 'frame')
        setFrames((f) => [m.frame, ...f.filter((x) => x.name !== m.frame.name)])
      else if (m.kind === 'removed') setFrames((f) => f.filter((x) => x.name !== m.name))
      else if (m.kind === 'frames') setFrames(m.frames)
    })
    return () => {
      live = false
      offOpen()
      offMessage()
    }
  }, [rip])

  useEffect(() => {
    if (open) rip?.send({ kind: 'camera', deviceId })
  }, [open, deviceId, rip])

  if (!open || !rip) return { remote: null, frames }
  const remote = {
    state,
    session: state?.session ?? null,
    frames,
    picker: state?.picker ?? 'moving',
    error: state?.error ?? null,
    start: (session: string) => {
      setFrames([])
      rip.send({ kind: 'start', session })
    },
    stop: () => rip.send({ kind: 'stop' }),
    keepNow: async () => rip.send({ kind: 'keep' }),
    remove: async (name: string) => rip.send({ kind: 'remove', name })
  }
  return { remote, frames }
}

const STATE_TEXT: Record<RipPickerState, string> = {
  moving: 'Moving',
  settling: 'Settling…',
  held: 'Held'
}

/**
 * Admin Rip capture: watches a live pack opening on a camera or capture card and keeps the key
 * frames (each card held still) as JPEGs on this computer, for scanner work on a game the scanner
 * doesn't know yet. Frames go to the data folder's rip-capture/<session>/, one folder a session.
 */
export function RipCaptureTab(): React.JSX.Element {
  const [deviceId, setDeviceId] = useState<string | null>(storedCamera)
  const { remote, frames: windowFrames } = useRipWindow(deviceId)
  // With the rip window open it has the camera; this tab leaves it alone.
  const camera = useCamera(deviceId, undefined, {
    remember: false,
    off: deviceId === null || remote !== null
  })
  const video = useRef<HTMLVideoElement>(null)
  const local = useRipCapture(video, remote ? null : camera.stream)
  const capture: RipCapture = remote ?? local
  const { session } = capture
  // A list the window captured stays up after it closes, until a session starts here.
  const frames = remote || local.session || local.frames.length ? capture.frames : windowFrames
  const resolution = remote ? (remote.state?.resolution ?? null) : cameraResolution(camera.stream)
  const cameraError = remote ? (remote.state?.cameraError ?? null) : camera.error
  const [uiError, setError] = useState<string | null>(null)
  const error = uiError ?? capture.error
  const [open, setOpen] = useState<RipFrame | null>(null)
  // The session running or last run: its note can still be written after Stop.
  const [last, setLast] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const savedNote = useRef('')

  useEffect(() => {
    if (video.current) video.current.srcObject = remote ? null : camera.stream
  }, [camera.stream, remote])

  // A local session stops when the window opens: the window has the camera now.
  const localSession = local.session
  const stopLocal = local.stop
  useEffect(() => {
    if (remote && localSession) stopLocal()
  }, [remote, localSession, stopLocal])

  const pickCamera = (id: string): void => {
    setDeviceId(id)
    try {
      localStorage.setItem(CAMERA_KEY, id)
    } catch {
      // Only costs the remembered choice.
    }
  }

  const keepNow = capture.keepNow
  // Space keeps the frame on screen while a session runs.
  useEffect(() => {
    if (!session) return
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null
      if (e.code !== 'Space' || t?.closest('input, textarea, button, [role="combobox"]')) return
      e.preventDefault()
      void keepNow()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [session, keepNow])

  const start = (): void => {
    const name = sessionName(new Date())
    setError(null)
    setNote('')
    savedNote.current = ''
    setLast(name)
    capture.start(name)
  }

  const saveNote = useCallback(
    (text: string): void => {
      if (!last || !api.admin || text.trim() === savedNote.current) return
      savedNote.current = text.trim()
      api.admin.captureNote(last, text).catch((e: unknown) => setError(errorText(e)))
    },
    [last]
  )

  // The note saves a moment after typing stops, and on leaving the box.
  useEffect(() => {
    const t = setTimeout(() => saveNote(note), 800)
    return () => clearTimeout(t)
  }, [note, saveNote])

  const remove = async (f: RipFrame): Promise<void> => {
    await capture.remove(f.name)
    if (open?.name === f.name) setOpen(null)
  }

  const openFolder = (): void => {
    api.admin?.captureOpenFolder(session ?? last).catch((e: unknown) => setError(errorText(e)))
  }

  const openWindow = (): void => {
    api.ripWindow.open().catch((e: unknown) => setError(errorText(e)))
  }

  // Whether there's a picture to capture from, here or in the window.
  const live = remote ? !!remote.state?.openDeviceId && !cameraError : !!camera.stream
  const retry = remote ? () => api.ripWindow.send({ kind: 'retryCamera' }) : camera.retry
  const cameraNote =
    deviceId === null
      ? 'Pick the camera or capture card the opening is on.'
      : cameraError === 'busy'
        ? 'That camera is in use by another app (OBS, or the scan window). Close it and try again.'
        : cameraError === 'denied'
          ? 'The app isn’t allowed to use the camera.'
          : cameraError
            ? 'That camera isn’t there. Pick another, or plug it back in.'
            : remote
              ? live
                ? 'Showing in the rip window. Double-click it (or press F11) for full screen.'
                : 'Opening the camera in the rip window…'
              : !camera.stream
                ? 'Opening the camera…'
                : null

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(320px,2fr)]">
      <Panel title="Live">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Select value={deviceId ?? undefined} onValueChange={pickCamera} disabled={!!session}>
            <SelectTrigger size="sm" aria-label="Camera" className="w-56">
              <SelectValue placeholder="Choose a camera" />
            </SelectTrigger>
            <SelectContent>
              {camera.devices
                .filter((d) => d.deviceId)
                .map((d, i) => (
                  <SelectItem key={d.deviceId} value={d.deviceId}>
                    {d.label || `Camera ${i + 1}`}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          {!remote && (
            <Button variant="outline" size="sm" onClick={openWindow}>
              Pop out
            </Button>
          )}
          <span className="flex-1" />
          {session ? (
            <>
              <Button variant="outline" size="sm" onClick={() => void keepNow()}>
                Keep this frame
              </Button>
              <Button variant="destructive" size="sm" onClick={capture.stop}>
                Stop
              </Button>
            </>
          ) : (
            <Button size="sm" disabled={!live} onClick={start}>
              Start capture
            </Button>
          )}
        </div>
        <div className="relative overflow-hidden rounded-md bg-black">
          <video
            ref={video}
            autoPlay
            muted
            playsInline
            className="aspect-video w-full object-contain"
          />
          {cameraNote && (
            <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-muted-foreground">
              <div className="space-y-2">
                <p>{cameraNote}</p>
                {cameraError && (
                  <Button variant="outline" size="sm" onClick={retry}>
                    Try again
                  </Button>
                )}
              </div>
            </div>
          )}
          {resolution && (
            <span className="absolute right-3 top-3 rounded-full bg-black/70 px-3 py-1 text-xs text-muted-foreground">
              {resolutionText(resolution)}
            </span>
          )}
          {session && live && (
            <div className="absolute left-3 top-3 flex items-center gap-2 rounded-full bg-black/70 px-3 py-1 text-xs">
              <span
                className={cn(
                  'size-2 rounded-full',
                  capture.picker === 'held'
                    ? 'bg-emerald-400'
                    : capture.picker === 'settling'
                      ? 'bg-amber-400'
                      : 'bg-red-500 animate-pulse'
                )}
              />
              {STATE_TEXT[capture.picker]}
            </div>
          )}
        </div>
        <div className="mt-3 space-y-1">
          {session ? (
            <Note>
              Session {session}: hold each card still for about a second and it’s kept. Space keeps
              the frame on screen.
            </Note>
          ) : (
            <Note>
              Start capture, then open packs as normal. Each card held still for about a second is
              kept as a full-size JPEG in the app’s data folder.
            </Note>
          )}
          {error && <p className="text-[13px] text-red-400">{error}</p>}
        </div>
        {last && (
          <label className="mt-3 block space-y-1">
            <span className="text-xs text-muted-foreground">
              Note on session {last} (what’s in it, what’s worth a look)
            </span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onBlur={() => saveNote(note)}
              rows={2}
              maxLength={4000}
              placeholder="e.g. 3 Foundations play boosters, foils in pack 2"
              className="w-full resize-y rounded-md border border-white/[0.08] bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-white/20"
            />
          </label>
        )}
      </Panel>
      <Panel title={`Key frames${frames.length ? ` (${frames.length})` : ''}`}>
        <div className="mb-3 flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={openFolder}>
            {session || last ? 'Open session folder' : 'Open capture folder'}
          </Button>
        </div>
        {frames.length === 0 ? (
          <Note>{session ? 'None yet.' : 'No session running.'}</Note>
        ) : (
          <ul className="grid max-h-[70vh] grid-cols-2 gap-2 overflow-y-auto pr-1 2xl:grid-cols-3">
            {frames.map((f) => (
              <li key={f.name} className="group relative">
                <button
                  type="button"
                  className="block w-full overflow-hidden rounded-md border border-white/[0.06]"
                  onClick={() => setOpen(f)}
                >
                  <img src={f.thumb} alt={f.name} className="aspect-video w-full object-cover" />
                </button>
                <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>
                    {f.name.slice(1, 6)} · {new Date(f.at).toLocaleTimeString()}
                    {f.manual ? ' · by hand' : ''}
                  </span>
                  <button
                    type="button"
                    className="opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100 focus-visible:opacity-100"
                    onClick={() => void remove(f)}
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Dialog open={open !== null} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="max-w-[90vw] sm:max-w-[90vw]">
          <DialogTitle className="text-sm">
            {open?.name} · {open?.width}×{open?.height}
            {open && !open.manual ? ` · sharpness ${open.sharp}` : ''}
          </DialogTitle>
          {open && <img src={open.thumb} alt={open.name} className="w-full rounded-md" />}
          {open && (
            <div className="flex justify-end">
              <Button variant="destructive" size="sm" onClick={() => void remove(open)}>
                Remove frame
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
