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

const VIDEO_BITRATES = [3_000_000, 1_500_000]

const aborted = (): DOMException => new DOMException('The replay was stopped', 'AbortError')

function canvasOf(
  w: number,
  h: number
): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
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
    // A hidden page stops drawing while the clock runs on: the video would freeze, so stop.
    const onHidden = (): void => {
      if (!document.hidden || stopped) return
      finish()
      reject(new Error('Keep Duel Binder open while the replay records'))
    }
    opts.signal.addEventListener('abort', onAbort, { once: true })
    document.addEventListener('visibilitychange', onHidden)
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data)
    }
    recorder.onstop = () => {
      opts.signal.removeEventListener('abort', onAbort)
      document.removeEventListener('visibilitychange', onHidden)
      if (!opts.signal.aborted && !document.hidden)
        resolve(new Blob(chunks, { type: type.mime.split(';')[0] }))
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
  for (const bitrate of VIDEO_BITRATES) {
    const blob = await recordOnce(scene, type, bitrate, opts)
    if (blob.size <= MAX_BYTES) return blob
  }
  throw new Error('The video came out too big')
}

const nextTask = (): Promise<void> => new Promise((r) => setTimeout(r))

export const VIDEO_FPS = 30

/**
 * The bitrate that fills about 80% of MAX_BYTES over `durationMs`, so a short replay gets more
 * detail than a long one; capped where more stops showing.
 */
export function videoBitrate(durationMs: number): number {
  const fit = (MAX_BYTES * 8 * 0.8) / (durationMs / 1000)
  return Math.round(Math.min(8_000_000, fit))
}

/** Whether this device can encode H.264 frame by frame (WebCodecs); else it records in real time. */
export async function canEncodeFrames(): Promise<boolean> {
  if (typeof VideoEncoder === 'undefined') return false
  const { canEncodeVideo } = await import('mediabunny')
  return canEncodeVideo('avc', { width: REPLAY_W, height: REPLAY_H }).catch(() => false)
}

/**
 * Whether this device encodes H.264 in hardware. Software H.264 (Chromium's OpenH264, all Linux
 * gets) turns the deep backdrop's soft dark gradients to blocks at any bitrate.
 */
async function encodesInHardware(): Promise<boolean> {
  const { canEncodeVideo } = await import('mediabunny')
  return canEncodeVideo('avc', {
    width: REPLAY_W,
    height: REPLAY_H,
    hardwareAcceleration: 'prefer-hardware'
  }).catch(() => false)
}

/**
 * Draws and encodes each frame in turn into an MP4: the deep backdrop where a hardware encoder can
 * carry it, the bright one where not. Unlike recording, no frame is dropped and the
 * encoder isn't rushed, so the bitrate goes where it's asked; smaller once if it's over the limit.
 */
export async function encodeVideoFrames(
  scene: ReplayScene,
  opts: { signal: AbortSignal; onProgress?: (p: number) => void }
): Promise<Blob> {
  const { BufferTarget, CanvasSource, Mp4OutputFormat, Output } = await import('mediabunny')
  const duration = scene.timeline.duration
  const count = Math.ceil((duration / 1000) * VIDEO_FPS)
  const first = videoBitrate(duration)
  const hardware = await encodesInHardware()
  const drawn: ReplayScene = { ...scene, backdrop: hardware ? 'deep' : 'bright' }
  for (const [attempt, bitrate] of [first, Math.round(first * 0.6)].entries()) {
    const { canvas, ctx } = canvasOf(REPLAY_W, REPLAY_H)
    const target = new BufferTarget()
    const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target })
    const source = new CanvasSource(canvas, {
      codec: 'avc',
      bitrate,
      bitrateMode: 'variable',
      latencyMode: 'quality',
      keyFrameInterval: 2,
      ...(hardware ? { hardwareAcceleration: 'prefer-hardware' as const } : {})
    })
    output.addVideoTrack(source, { frameRate: VIDEO_FPS })
    await output.start()
    try {
      for (let i = 0; i < count; i++) {
        if (opts.signal.aborted) throw aborted()
        drawReplayFrame(ctx, drawn, (i * 1000) / VIDEO_FPS)
        await source.add(i / VIDEO_FPS, 1 / VIDEO_FPS)
        opts.onProgress?.((attempt + (i + 1) / count) / 2)
      }
      await output.finalize()
    } catch (e) {
      await output.cancel().catch(() => undefined)
      throw e
    }
    const buffer = target.buffer
    if (buffer && buffer.byteLength <= MAX_BYTES) return new Blob([buffer], { type: 'video/mp4' })
  }
  throw new Error('The video came out too big')
}

/**
 * Steps the scene frame by frame into a GIF, smaller each time it comes out over MAX_BYTES. Always
 * the deep backdrop: GIF has no blocks to fear.
 */
export async function encodeGif(
  given: ReplayScene,
  opts: { signal: AbortSignal; onProgress?: (p: number) => void }
): Promise<Blob> {
  const scene: ReplayScene = { ...given, backdrop: 'deep' }
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
