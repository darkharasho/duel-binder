// Rip capture's card comparison, off the UI thread: OpenCV finds the card in a key frame.
import type { RgbaImage } from '@shared/scan/types'
import { loadCv } from '../scan/vision/cv'
import { cardLook } from './cardLook'

export interface LookRequest {
  id: number
  frame: RgbaImage
}
export interface LookReply {
  id: number
  look: Float32Array | null
}

interface WorkerScope {
  onmessage: ((e: MessageEvent<LookRequest>) => void) | null
  postMessage(msg: LookReply, transfer?: Transferable[]): void
}
const scope = self as unknown as WorkerScope

let queue = Promise.resolve()
scope.onmessage = (e) => {
  const { id, frame } = e.data
  queue = queue.then(async () => {
    let look: Float32Array | null = null
    try {
      look = cardLook(await loadCv(), frame)
    } catch {
      // No look: the picker falls back to comparing whole frames.
    }
    scope.postMessage({ id, look }, look ? [look.buffer] : [])
  })
}
