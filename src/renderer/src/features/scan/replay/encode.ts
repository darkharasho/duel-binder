import { applyPalette, GIFEncoder, quantize } from 'gifenc'
import { drawReplayFrame, REPLAY_H, REPLAY_W, type ReplayScene } from './draw'

/** Discord's upload limit without Nitro. */
export const MAX_BYTES = 10 * 1024 * 1024

export type ReplayFormat = 'video' | 'gif'

export interface VideoType {
  mime: string
  ext: 'mp4' | 'webm'
}

const VIDEO_TYPES: VideoType[] = [
  { mime: 'video/mp4;codecs=avc1', ext: 'mp4' },
  { mime: 'video/mp4', ext: 'mp4' },
  { mime: 'video/webm;codecs=vp9', ext: 'webm' },
  { mime: 'video/webm', ext: 'webm' }
]

const recorderSupports = (mime: string): boolean =>
  typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(mime)

/** The first kind of video this device can record: MP4 where it can, else WebM; null with neither. */
export function pickVideoType(
  isSupported: (mime: string) => boolean = recorderSupports
): VideoType | null {
  return VIDEO_TYPES.find((t) => isSupported(t.mime)) ?? null
}

/** GIF attempts, largest first; each smaller one is tried when the last came out over MAX_BYTES. */
export const GIF_STEPS = [
  { w: 360, h: 450, fps: 10 },
  { w: 288, h: 360, fps: 8 },
  { w: 240, h: 300, fps: 6 }
]

const VIDEO_BITRATES = [2_000_000, 1_000_000]

const aborted = (): DOMException => new DOMException('The replay was stopped', 'AbortError')

function canvasOf(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error("Couldn't draw the replay")
  return { canvas, ctx }
}

/** One real-time recording of the scene at `bitrate`. */
function recordOnce(
  scene: ReplayScene,
  type: VideoType,
  bitrate: number,
  opts: { signal: AbortSignal; onProgress?: (p: number) => void }
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    if (opts.signal.aborted) return reject(aborted())
    const { canvas, ctx } = canvasOf(REPLAY_W, REPLAY_H)
    drawReplayFrame(ctx, scene, 0)
    const stream = canvas.captureStream(30)
    const recorder = new MediaRecorder(stream, { mimeType: type.mime, videoBitsPerSecond: bitrate })
    const chunks: Blob[] = []
    let frame = 0
    let stopped = false
    const duration = scene.timeline.duration
    const finish = (): void => {
      if (stopped) return
      stopped = true
      cancelAnimationFrame(frame)
      if (recorder.state !== 'inactive') recorder.stop()
      stream.getTracks().forEach((t) => t.stop())
    }
    const onAbort = (): void => {
      finish()
      reject(aborted())
    }
    opts.signal.addEventListener('abort', onAbort, { once: true })
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data)
    }
    recorder.onstop = () => {
      opts.signal.removeEventListener('abort', onAbort)
      if (!opts.signal.aborted) resolve(new Blob(chunks, { type: type.mime.split(';')[0] }))
    }
    recorder.onerror = () => {
      finish()
      reject(new Error("Couldn't record the replay"))
    }
    const start = performance.now()
    const tick = (): void => {
      const t = performance.now() - start
      drawReplayFrame(ctx, scene, t)
      opts.onProgress?.(Math.min(1, t / duration))
      if (t >= duration) finish()
      else frame = requestAnimationFrame(tick)
    }
    recorder.start(1000)
    frame = requestAnimationFrame(tick)
  })
}

/** Plays the scene in real time and records it; once more at a lower bitrate if it's over the limit. */
export async function recordVideo(
  scene: ReplayScene,
  type: VideoType,
  opts: { signal: AbortSignal; onProgress?: (p: number) => void }
): Promise<Blob> {
  let blob: Blob | null = null
  for (const bitrate of VIDEO_BITRATES) {
    blob = await recordOnce(scene, type, bitrate, opts)
    if (blob.size <= MAX_BYTES) return blob
  }
  throw new Error('The video came out too big')
}

const nextTask = (): Promise<void> => new Promise((r) => setTimeout(r))

/** Steps the scene frame by frame into a GIF, smaller each time it comes out over MAX_BYTES. */
export async function encodeGif(
  scene: ReplayScene,
  opts: { signal: AbortSignal; onProgress?: (p: number) => void }
): Promise<Blob> {
  const duration = scene.timeline.duration
  for (const [attempt, step] of GIF_STEPS.entries()) {
    const { ctx } = canvasOf(step.w, step.h)
    const gif = GIFEncoder()
    const count = Math.ceil((duration / 1000) * step.fps)
    const delay = 1000 / step.fps
    for (let i = 0; i < count; i++) {
      if (opts.signal.aborted) throw aborted()
      ctx.setTransform(step.w / REPLAY_W, 0, 0, step.h / REPLAY_H, 0, 0)
      drawReplayFrame(ctx, scene, i * delay)
      const { data } = ctx.getImageData(0, 0, step.w, step.h)
      const palette = quantize(data, 256)
      gif.writeFrame(applyPalette(data, palette), step.w, step.h, { palette, delay })
      opts.onProgress?.((attempt + (i + 1) / count) / GIF_STEPS.length)
      if (i % 5 === 4) await nextTask()
    }
    gif.finish()
    const bytes = gif.bytes()
    if (bytes.length <= MAX_BYTES) return new Blob([bytes as BlobPart], { type: 'image/gif' })
  }
  throw new Error('The GIF came out too big')
}
