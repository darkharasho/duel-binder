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
import { cameraResolution, useCamera } from '../scan/useCamera'
import { errorText } from './adminTabs'
import { KeyframePicker, PICK_H, PICK_W, toGrey, type PickerState } from './keyframes'
import { Note, Panel } from './parts'

const CAMERA_KEY = 'admin.ripCapture.camera'
/** Samples a second: enough to catch a card held for about ¾ s (3 still samples). */
const SAMPLE_MS = 250
/** Full frames kept back, so the sharpest of a still stretch can still be saved. */
const KEEP_BACK = 5
const THUMB_W = 640
const JPEG_QUALITY = 0.92

interface Frame {
  name: string
  thumb: string
  sharp: number
  at: Date
  width: number
  height: number
  /** Kept by hand rather than picked. */
  manual: boolean
}

const pad = (n: number, w = 2): string => String(n).padStart(w, '0')

/** A session's folder name: its local start time. */
function sessionName(d: Date): string {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

function storedCamera(): string | null {
  try {
    return localStorage.getItem(CAMERA_KEY)
  } catch {
    return null
  }
}

/** The page's CSP lets images load from data: URLs, not blob: ones. */
function dataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

async function jpegOf(
  src: CanvasImageSource,
  w: number,
  h: number,
  quality = JPEG_QUALITY
): Promise<Blob> {
  const canvas = new OffscreenCanvas(w, h)
  canvas.getContext('2d')!.drawImage(src, 0, 0, w, h)
  return canvas.convertToBlob({ type: 'image/jpeg', quality })
}

const STATE_TEXT: Record<PickerState, string> = {
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
  const camera = useCamera(deviceId, undefined, { remember: false, off: deviceId === null })
  const resolution = cameraResolution(camera.stream)
  const [session, setSession] = useState<string | null>(null)
  const [frames, setFrames] = useState<Frame[]>([])
  const [state, setState] = useState<PickerState>('moving')
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<Frame | null>(null)
  // The session running or last run: its note can still be written after Stop.
  const [last, setLast] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const savedNote = useRef('')

  const video = useRef<HTMLVideoElement>(null)
  const picker = useRef(new KeyframePicker())
  const recent = useRef<{ seq: number; bitmap: ImageBitmap; grey: Uint8Array }[]>([])
  const count = useRef(0)
  const saving = useRef(Promise.resolve())

  useEffect(() => {
    if (video.current) video.current.srcObject = camera.stream
  }, [camera.stream])

  const pickCamera = (id: string): void => {
    setDeviceId(id)
    try {
      localStorage.setItem(CAMERA_KEY, id)
    } catch {
      // Only costs the remembered choice.
    }
  }

  // Saves one full frame, in order, and lists it.
  const keep = useCallback(
    (bitmap: ImageBitmap, sharp: number, manual: boolean): void => {
      if (!session || !api.admin) return
      const admin = api.admin
      const name = `k${pad(++count.current, 5)}.jpg`
      const { width, height } = bitmap
      saving.current = saving.current.then(async () => {
        try {
          const [full, thumb] = await Promise.all([
            jpegOf(bitmap, width, height),
            jpegOf(bitmap, THUMB_W, Math.round((THUMB_W * height) / width), 0.8)
          ])
          await admin.captureSave(session, name, await full.arrayBuffer(), {
            sharp,
            width,
            height
          })
          const frame: Frame = {
            name,
            thumb: await dataUrl(thumb),
            sharp: Math.round(sharp),
            at: new Date(),
            width,
            height,
            manual
          }
          setFrames((f) => [frame, ...f])
          setError(null)
        } catch (e) {
          setError(errorText(e))
        } finally {
          bitmap.close()
        }
      })
    },
    [session]
  )

  // The sampling loop: a small grey copy for the picker, and the last few full frames.
  useEffect(() => {
    const v = video.current
    if (!session || !camera.stream || !v) return
    const pick = picker.current
    const small = new OffscreenCanvas(PICK_W, PICK_H)
    const ctx = small.getContext('2d', { willReadFrequently: true })!
    let busy = false
    const timer = setInterval(async () => {
      if (busy || v.readyState < 2 || !v.videoWidth) return
      busy = true
      try {
        const bitmap = await createImageBitmap(v)
        ctx.drawImage(bitmap, 0, 0, PICK_W, PICK_H)
        const grey = toGrey(ctx.getImageData(0, 0, PICK_W, PICK_H).data)
        const { seq, pick: chosen } = pick.push(grey)
        recent.current.push({ seq, bitmap, grey })
        while (recent.current.length > KEEP_BACK) recent.current.shift()!.bitmap.close()
        setState(pick.state)
        if (chosen) {
          const at = recent.current.find((r) => r.seq === chosen.seq)
          // The kept copy outlives this buffer, which closes its own.
          if (at) keep(await createImageBitmap(at.bitmap), chosen.sharp, false)
        }
      } catch {
        // A frame that can't be read (camera switching) is skipped.
      } finally {
        busy = false
      }
    }, SAMPLE_MS)
    return () => {
      clearInterval(timer)
      for (const r of recent.current) r.bitmap.close()
      recent.current = []
      pick.reset()
    }
  }, [session, camera.stream, keep])

  const keepNow = useCallback(async (): Promise<void> => {
    const v = video.current
    if (!session || !v || v.readyState < 2) return
    const bitmap = await createImageBitmap(v)
    const last = recent.current.at(-1)
    if (last) picker.current.markKept(last.grey)
    keep(bitmap, 0, true)
  }, [session, keep])

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
    setFrames([])
    count.current = 0
    setError(null)
    setNote('')
    savedNote.current = ''
    setLast(name)
    setSession(name)
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

  const remove = async (f: Frame): Promise<void> => {
    if (!session || !api.admin) return
    try {
      await api.admin.captureRemove(session, f.name)
      setFrames((all) => all.filter((x) => x !== f))
      if (open === f) setOpen(null)
    } catch (e) {
      setError(errorText(e))
    }
  }

  const openFolder = (): void => {
    api.admin?.captureOpenFolder(session ?? last).catch((e: unknown) => setError(errorText(e)))
  }

  const cameraNote =
    deviceId === null
      ? 'Pick the camera or capture card the opening is on.'
      : camera.error === 'busy'
        ? 'That camera is in use by another app (OBS, or the scan window). Close it and try again.'
        : camera.error === 'denied'
          ? 'The app isn’t allowed to use the camera.'
          : camera.error
            ? 'That camera isn’t there. Pick another, or plug it back in.'
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
          <span className="flex-1" />
          {session ? (
            <>
              <Button variant="outline" size="sm" onClick={() => void keepNow()}>
                Keep this frame
              </Button>
              <Button variant="destructive" size="sm" onClick={() => setSession(null)}>
                Stop
              </Button>
            </>
          ) : (
            <Button size="sm" disabled={!camera.stream} onClick={start}>
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
                {camera.error && (
                  <Button variant="outline" size="sm" onClick={camera.retry}>
                    Try again
                  </Button>
                )}
              </div>
            </div>
          )}
          {resolution && (
            <span className="absolute right-3 top-3 rounded-full bg-black/70 px-3 py-1 text-xs text-muted-foreground">
              {resolution.width}×{resolution.height}
              {resolution.frameRate ? ` · ${Math.round(resolution.frameRate)} fps` : ''}
            </span>
          )}
          {session && camera.stream && (
            <div className="absolute left-3 top-3 flex items-center gap-2 rounded-full bg-black/70 px-3 py-1 text-xs">
              <span
                className={cn(
                  'size-2 rounded-full',
                  state === 'held'
                    ? 'bg-emerald-400'
                    : state === 'settling'
                      ? 'bg-amber-400'
                      : 'bg-red-500 animate-pulse'
                )}
              />
              {STATE_TEXT[state]}
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
                    {f.name.slice(1, 6)} · {f.at.toLocaleTimeString()}
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
