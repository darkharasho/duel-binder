import { useEffect, useRef, useState } from 'react'
import { ImageUp } from 'lucide-react'
import { parseSlabQr, type SlabQr } from '@shared/scan/slabQr'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { useBackHandler } from '@/lib/backStack'
import { useScanCamera } from '@/features/scan/ScanHub'
import { decodeQr } from './qrDecode'

/** How often a camera frame is looked at for a QR code. */
const EVERY_MS = 200

type Status = 'starting' | 'looking' | 'no-camera' | 'not-a-slab' | 'none-in-photo'

const MESSAGES: Record<Status, string> = {
  starting: 'Opening the camera…',
  looking: 'Hold the label’s QR code close to the camera.',
  'no-camera': 'No camera to use. Choose a photo of the label instead.',
  'not-a-slab': 'That QR code isn’t a grading company’s link. Try the one on the label.',
  'none-in-photo': 'No QR code found in that photo. Try a closer one.'
}

/**
 * Reads a slab label's QR code with the camera, or from a photo, for its grader and cert number.
 * Everything happens on the device. `onRead` hears the first grader's link found.
 */
export function QrScanDialog({
  open,
  onClose,
  onRead
}: {
  open: boolean
  onClose: () => void
  onRead: (qr: SlabQr) => void
}): React.JSX.Element {
  useBackHandler(open, onClose)
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="grid-cols-[minmax(0,1fr)] sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Scan the label’s QR code</DialogTitle>
          <DialogDescription>Fills in the grading company and cert number.</DialogDescription>
        </DialogHeader>
        {open && <Scanner onRead={onRead} />}
      </DialogContent>
    </Dialog>
  )
}

function Scanner({ onRead }: { onRead: (qr: SlabQr) => void }): React.JSX.Element {
  const video = useRef<HTMLVideoElement>(null)
  const file = useRef<HTMLInputElement>(null)
  const [status, setStatus] = useState<Status>('starting')
  // What the last QR code that wasn't a grader's link said, shown so an unknown grader's can be told.
  const [unknown, setUnknown] = useState<string | null>(null)
  // The Scan tab's camera, so a desk with two webcams reads the one aimed at the cards.
  const camera = useScanCamera()
  const cameraRef = useRef(camera)
  const done = useRef(false)
  const reading = useRef(onRead)
  useEffect(() => {
    reading.current = onRead
  })

  /** The QR text read, handed on when it's a grader's link; false when it isn't one. */
  const take = (text: string): boolean => {
    const qr = parseSlabQr(text)
    if (!qr) return false
    if (!done.current) {
      done.current = true
      reading.current(qr)
    }
    return true
  }

  useEffect(() => {
    const v = video.current
    let stream: MediaStream | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    let gone = false
    const look = async (): Promise<void> => {
      if (gone || done.current || !v) return
      if (v.readyState >= 2) {
        const text = await decodeQr(v, v.videoWidth, v.videoHeight)
        if (gone || done.current) return
        if (text && !take(text)) {
          setStatus('not-a-slab')
          setUnknown(text)
        }
      }
      timer = setTimeout(() => void look(), EVERY_MS)
    }
    void (async () => {
      try {
        const camera = cameraRef.current
        const open = (exact: string | null): Promise<MediaStream> =>
          navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
              // 4K where the camera has it: a slab's QR code is small.
              width: { ideal: 3840 },
              height: { ideal: 2160 },
              // Exact: an ideal deviceId loses to another camera nearer the size asked for.
              ...(exact ? { deviceId: { exact } } : { facingMode: { ideal: 'environment' } })
            }
          })
        try {
          stream = await open(camera)
        } catch (e) {
          // The Scan tab's camera is gone (unplugged): any camera will do.
          if (!camera || !(e instanceof DOMException) || e.name !== 'OverconstrainedError') throw e
          stream = await open(null)
        }
        if (gone || !v) return
        v.srcObject = stream
        await v.play().catch(() => undefined)
        setStatus('looking')
        void look()
      } catch {
        if (!gone) setStatus('no-camera')
      }
    })()
    return () => {
      gone = true
      clearTimeout(timer)
      stream?.getTracks().forEach((t) => t.stop())
      if (v) v.srcObject = null
    }
    // Opened once per dialog: take only reads refs.
  }, [])

  const fromPhoto = async (f: File): Promise<void> => {
    try {
      const bitmap = await createImageBitmap(f)
      try {
        const text = await decodeQr(bitmap, bitmap.width, bitmap.height)
        if (!text) setStatus('none-in-photo')
        else if (!take(text)) {
          setStatus('not-a-slab')
          setUnknown(text)
        }
      } finally {
        bitmap.close()
      }
    } catch {
      setStatus('none-in-photo')
    }
  }

  return (
    <div className="space-y-3">
      {status !== 'no-camera' && (
        <div className="relative overflow-hidden rounded-md bg-black">
          <video ref={video} muted playsInline className="aspect-video w-full object-cover" />
          {/* Where the label goes: the middle is looked at closest. */}
          <div
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-1/2 aspect-square h-3/5 -translate-x-1/2 -translate-y-1/2 rounded-md border-2 border-white/70"
          />
        </div>
      )}
      <p role="status" className="text-sm text-muted-foreground">
        {MESSAGES[status]}
      </p>
      {status === 'not-a-slab' && unknown && (
        <p className="break-all text-xs text-muted-foreground">
          It says: <span className="font-mono">{unknown.slice(0, 200)}</span>
        </p>
      )}
      <input
        ref={file}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (f) void fromPhoto(f)
        }}
      />
      <Button type="button" variant="outline" size="sm" onClick={() => file.current?.click()}>
        <ImageUp aria-hidden />
        Choose photo
      </Button>
    </div>
  )
}
