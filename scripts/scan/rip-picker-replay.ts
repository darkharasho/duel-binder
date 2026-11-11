/**
 * Rip capture's same-card check on saved key frames: for each folder of k#####.jpg frames, scores
 * each frame against the one before with the shipped cardLook and lists the pairs it would call
 * the same card (the picker would have kept only the first).
 *
 *   npm run scan:rip-replay -- <folder> [<folder> …]
 */
import { readFileSync, readdirSync } from 'node:fs'
import jpeg from 'jpeg-js'
import type { RgbaImage } from '../../src/shared/scan/types'
import { loadCv } from '../../src/renderer/src/features/scan/vision/cv'
import {
  cardLook,
  LOOK_W,
  lookDiff,
  SAME_CARD
} from '../../src/renderer/src/features/admin/cardLook'

async function main(): Promise<void> {
  const cv = await loadCv()
  // The app draws the full frame at LOOK_W wide before looking for the card.
  const look = (path: string): Float32Array | null => {
    const img = jpeg.decode(readFileSync(path), {
      useTArray: true,
      formatAsRGBA: true,
      maxMemoryUsageInMB: 1024
    }) as RgbaImage
    const h = Math.round((LOOK_W * img.height) / img.width)
    const src = new cv.Mat(img.height, img.width, cv.CV_8UC4)
    const dst = new cv.Mat()
    try {
      src.data.set(img.data)
      cv.resize(src, dst, new cv.Size(LOOK_W, h), 0, 0, cv.INTER_AREA)
      return cardLook(cv, { width: LOOK_W, height: h, data: new Uint8ClampedArray(dst.data) })
    } finally {
      src.delete()
      dst.delete()
    }
  }
  for (const dir of process.argv.slice(2)) {
    const files = readdirSync(dir)
      .filter((f) => /^k\d+\.jpg$/.test(f))
      .sort()
    let prev: Float32Array | null = null
    let same = 0
    let noCard = 0
    const t0 = performance.now()
    for (const [i, f] of files.entries()) {
      const l = look(`${dir}/${f}`)
      if (!l) noCard++
      if (i && l && prev) {
        const d = lookDiff(l, prev)
        if (d < SAME_CARD) same++
        console.log(`${f}\t${d.toFixed(1)}${d < SAME_CARD ? '\tsame card' : ''}`)
      } else if (i) console.log(`${f}\t-\tno card, whole-frame check`)
      prev = l
    }
    const ms = (performance.now() - t0) / Math.max(1, files.length)
    console.log(
      `${dir}: ${files.length} frames, ${same} same as the one before, ${noCard} with no card, ${ms.toFixed(0)} ms a frame`
    )
  }
}
void main()
