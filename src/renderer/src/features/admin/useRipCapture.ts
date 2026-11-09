import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import type { RipFrame, RipPickerState } from '@shared/ripWindow'
import { api } from '@/lib/api'
import { errorText } from './adminTabs'
import { KeyframePicker, PICK_H, PICK_W, toGrey } from './keyframes'

/** Samples a second: enough to catch a card held for about ¾ s (3 still samples). */
const SAMPLE_MS = 250
/** Full frames kept back, so the sharpest of a still stretch can still be saved. */
const KEEP_BACK = 5
const THUMB_W = 640
const JPEG_QUALITY = 0.92

const pad = (n: number, w = 2): string => String(n).padStart(w, '0')

/** A session's folder name: its local start time. */
export function sessionName(d: Date): string {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
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

export interface RipCapture {
  session: string | null
  /** The session's frames, newest first. */
  frames: RipFrame[]
  picker: RipPickerState
  error: string | null
  start(session: string): void
  stop(): void
  /** Keeps the frame on screen now. */
  keepNow(): Promise<void>
  remove(name: string): Promise<void>
}

/**
 * The capture itself: samples the video while a session runs, keeps the sharpest frame of each
 * still stretch (and any kept by hand), and saves them through the admin API. The Admin tab runs
 * it on its own preview, or the rip window runs it on the camera filling the window.
 */
export function useRipCapture(
  video: RefObject<HTMLVideoElement | null>,
  stream: MediaStream | null,
  events: { onFrame?(f: RipFrame): void; onRemoved?(name: string): void } = {}
): RipCapture {
  const [session, setSession] = useState<string | null>(null)
  const [frames, setFrames] = useState<RipFrame[]>([])
  const [picker, setPicker] = useState<RipPickerState>('moving')
  const [error, setError] = useState<string | null>(null)
  const pick = useRef(new KeyframePicker())
  const recent = useRef<{ seq: number; bitmap: ImageBitmap; grey: Uint8Array }[]>([])
  const count = useRef(0)
  const saving = useRef(Promise.resolve())
  const on = useRef(events)
  useEffect(() => {
    on.current = events
  })

  // Saves one full frame, in order, and lists it.
  const keep = useCallback(
    (bitmap: ImageBitmap, sharp: number, manual: boolean): void => {
      if (!session || !api.admin) {
        bitmap.close()
        return
      }
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
          const frame: RipFrame = {
            name,
            thumb: await dataUrl(thumb),
            sharp: Math.round(sharp),
            at: Date.now(),
            width,
            height,
            manual
          }
          setFrames((f) => [frame, ...f])
          setError(null)
          on.current.onFrame?.(frame)
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
    if (!session || !stream || !v) return
    const p = pick.current
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
        const { seq, pick: chosen } = p.push(grey)
        recent.current.push({ seq, bitmap, grey })
        while (recent.current.length > KEEP_BACK) recent.current.shift()!.bitmap.close()
        setPicker(p.state)
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
      p.reset()
    }
  }, [session, stream, keep, video])

  // The React Compiler memoizes this; a manual useCallback can't name video.current.
  const keepNow = async (): Promise<void> => {
    const v = video.current
    if (!session || !v || v.readyState < 2) return
    const bitmap = await createImageBitmap(v)
    const last = recent.current.at(-1)
    if (last) pick.current.markKept(last.grey)
    keep(bitmap, 0, true)
  }

  const start = useCallback((name: string): void => {
    setFrames([])
    count.current = 0
    setError(null)
    setPicker('moving')
    setSession(name)
  }, [])

  const stop = useCallback((): void => setSession(null), [])

  const remove = useCallback(
    async (name: string): Promise<void> => {
      if (!session || !api.admin) return
      try {
        await api.admin.captureRemove(session, name)
        setFrames((all) => all.filter((x) => x.name !== name))
        on.current.onRemoved?.(name)
      } catch (e) {
        setError(errorText(e))
      }
    },
    [session]
  )

  return { session, frames, picker, error, start, stop, keepNow, remove }
}
