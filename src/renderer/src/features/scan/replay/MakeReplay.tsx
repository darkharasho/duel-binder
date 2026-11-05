import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { ScanRow } from '../session'
import { loadReplayArt, loadReplayLogo } from './art'
import { loadReplayFonts } from './draw'
import {
  canEncodeFrames,
  encodeGif,
  encodeVideoFrames,
  pickVideoType,
  recordVideo,
  type ReplayFormat
} from './encode'
import { pickReplayPulls, replayHeader } from './pulls'
import { replayFileName, saveReplay, type SaveResult } from './save'
import { replayTimeline } from './timeline'

type Make = (
  rows: ScanRow[],
  format: ReplayFormat,
  opts: { signal: AbortSignal; onProgress: (p: number) => void }
) => Promise<SaveResult>

/** The whole replay: pick the pulls, load their art, draw and encode, then save it. */
const makeReplay: Make = async (rows, format, opts) => {
  const [loaded, logo] = await Promise.all([
    loadReplayArt(pickReplayPulls(rows)),
    loadReplayLogo(),
    loadReplayFonts()
  ])
  if (loaded.pulls.length === 0) throw new Error("Couldn't load the card art")
  const scene = {
    ...loaded,
    logo,
    header: replayHeader(rows),
    timeline: replayTimeline(loaded.pulls.length)
  }
  if (format === 'gif') return saveReplay(await encodeGif(scene, opts), replayFileName('gif'))
  // Frame by frame where the device can: sharper, and faster than playing it through.
  if (await canEncodeFrames())
    return saveReplay(await encodeVideoFrames(scene, opts), replayFileName('mp4'))
  const video = pickVideoType()
  if (!video) return saveReplay(await encodeGif(scene, opts), replayFileName('gif'))
  return saveReplay(await recordVideo(scene, video, opts), replayFileName(video.ext))
}

const isAbort = (e: unknown): boolean => e instanceof DOMException && e.name === 'AbortError'

/** The phone Stream's round control, as its other end-of-stream buttons. */
const PHONE_CONTROL =
  'h-11 rounded-full border border-white/[0.13] bg-black/55 px-5 text-[15px] font-semibold text-white backdrop-blur-xl active:bg-black/70 disabled:opacity-50'

/**
 * Make replay: a short video of the night's best pulls, saved to the device. Beside it, the format
 * (MP4 or GIF) where this device can record video at all.
 */
export function MakeReplay({
  rows,
  variant,
  make = makeReplay
}: {
  rows: ScanRow[]
  variant: 'phone' | 'desktop'
  make?: Make
}): React.JSX.Element {
  const [format, setFormat] = useState<ReplayFormat>('video')
  const [progress, setProgress] = useState<number | null>(null)
  const controller = useRef<AbortController | null>(null)
  useEffect(() => () => controller.current?.abort(), [])

  const video = pickVideoType()
  const canVideo = video !== null
  const videoLabel = video?.ext.toUpperCase() ?? 'MP4'
  const chosen: ReplayFormat = canVideo ? format : 'gif'
  const empty = pickReplayPulls(rows).length === 0

  const start = async (): Promise<void> => {
    const ac = new AbortController()
    controller.current = ac
    setProgress(0)
    try {
      const result = await make(rows, chosen, { signal: ac.signal, onProgress: setProgress })
      if (result.saved)
        toast.success('Replay saved', result.where ? { description: result.where } : undefined)
    } catch (e) {
      if (!isAbort(e) && !ac.signal.aborted)
        toast.error(e instanceof Error ? e.message : "Couldn't make the replay")
    } finally {
      // A cancel has already put the button back; anything else ends here.
      if (controller.current === ac) {
        controller.current = null
        setProgress(null)
      }
    }
  }

  const cancel = (): void => {
    controller.current?.abort()
    controller.current = null
    setProgress(null)
  }

  if (progress !== null)
    return (
      <span className="flex items-center gap-3 text-sm">
        <span role="status" className={cn(variant === 'phone' && 'font-semibold text-white')}>
          Making replay… {Math.round(progress * 100)}%
        </span>
        <button type="button" className="underline underline-offset-2" onClick={cancel}>
          Cancel
        </button>
      </span>
    )

  const formatToggle = canVideo && (
    <button
      type="button"
      aria-label={`Replay format: ${format === 'video' ? videoLabel : 'GIF'}`}
      className={
        variant === 'phone'
          ? PHONE_CONTROL
          : 'h-8 rounded-md border px-2 text-xs font-medium hover:bg-accent'
      }
      onClick={() => setFormat((f) => (f === 'video' ? 'gif' : 'video'))}
    >
      {format === 'video' ? videoLabel : 'GIF'}
    </button>
  )

  return (
    <span className="flex items-center gap-2">
      {variant === 'phone' ? (
        <button type="button" className={PHONE_CONTROL} disabled={empty} onClick={start}>
          Make replay
        </button>
      ) : (
        <Button variant="outline" size="sm" disabled={empty} onClick={start}>
          Make replay
        </Button>
      )}
      {!empty && formatToggle}
      {empty && (
        <span
          className={cn('text-xs', variant === 'phone' ? 'text-white/60' : 'text-muted-foreground')}
        >
          No pulls to replay
        </span>
      )}
    </span>
  )
}
