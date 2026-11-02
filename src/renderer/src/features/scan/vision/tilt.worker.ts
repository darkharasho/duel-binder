// The tilt reading, off the vision worker: tiltFeatures takes about 300 ms a reading, and a live
// frame sent to the vision worker meanwhile would wait behind it. It holds no state: the frames
// come with each request, kept by the vision worker.
import { tiltFeatures, type TiltReading } from '@shared/scan/tiltFeatures'
import type { GameId } from '@shared/games/types'

export type TiltRequest = { type: 'read'; id: number; game: GameId; frames: Uint8Array[] }
export type TiltReply =
  | { type: 'reading'; id: number; reading: TiltReading | null }
  | { type: 'error'; id: number; message: string }

interface WorkerScope {
  onmessage: ((e: MessageEvent<TiltRequest>) => void) | null
  postMessage(msg: TiltReply): void
}
const scope = self as unknown as WorkerScope

scope.onmessage = (e) => {
  const msg = e.data
  if (msg.type !== 'read') return
  try {
    scope.postMessage({ type: 'reading', id: msg.id, reading: tiltFeatures(msg.frames, msg.game) })
  } catch (err) {
    scope.postMessage({
      type: 'error',
      id: msg.id,
      message: err instanceof Error ? err.message : String(err)
    })
  }
}
