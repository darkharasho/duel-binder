// Stage one of the rarity evaluation: finds the card in each photo with the scanner's own
// recognizeArt and saves it straightened and upright at CARD_W, the image the scan worker reads
// rarity cues from. Clean scans can be put through synthetic camera conditions first.
//
//   npx vite build --config scripts/scan/rarity/vite.config.ts
//   node out/rarity/extract.mjs <jobs.json> <out dir> [fingerprints.bin] [images.json]
//
// jobs.json: [{ key, path, cardId?, degradeSeed? }]. Writes <out dir>/<key>.jpg and appends one
// line per job to <out dir>/extract.jsonl: { key, status, topCardId, distance, forced }. status
// is "own" when the scanner's best match was the expected card, "forced" when it was found only
// with the lookup narrowed to that card's artworks, "other" when it matched another card and
// "none" when no card was found or none matched. Re-runnable: done keys are skipped.
// Everything this reads and writes is private (camera shots, downloaded images) and stays out of
// the repo.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { encode } from 'jpeg-js'
import { decodeFingerprints } from '@shared/scan/fingerprintFile'
import { ART_MAX_DISTANCE } from '@shared/scan/thresholds'
import type { RgbaImage } from '@shared/scan/types'
import { loadCv, type CV } from '../../../src/renderer/src/features/scan/vision/cv'
import { toMat } from '../../../src/renderer/src/features/scan/vision/detect'
import { recognizeArt } from '../../../src/renderer/src/features/scan/vision/candidates'
import { degrade } from './degrade'
import { loadImage } from './load'

interface Job {
  key: string
  path: string
  cardId?: number | null
  degradeSeed?: number
  /** Longest side to shrink the photo to first, e.g. to a webcam-sized card. */
  fitMax?: number
  /**
   * A frame to shrink the photo to fit first, [width, height] either way round, by area
   * averaging: [1080, 1440] is a phone camera's 1080p stream cropped to the scanner's 3:4.
   */
  fitBox?: [number, number]
}

/** Shrinks a photo past 1920 px wide by whole-pixel box averaging, as a webcam frame would be. */
function fit(img: RgbaImage, max = 1920): RgbaImage {
  const f = Math.ceil(Math.max(img.width, img.height) / max)
  if (f <= 1) return img
  const width = Math.floor(img.width / f)
  const height = Math.floor(img.height / f)
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      for (let c = 0; c < 4; c++) {
        let s = 0
        for (let dy = 0; dy < f; dy++)
          for (let dx = 0; dx < f; dx++)
            s += img.data[((y * f + dy) * img.width + x * f + dx) * 4 + c]
        data[(y * width + x) * 4 + c] = s / (f * f)
      }
  return { width, height, data }
}

/** Shrinks a photo to fit within box (either way round) with OpenCV's area resampling. */
function fitBox(cv: CV, img: RgbaImage, box: [number, number]): RgbaImage {
  const [short, long] = [Math.min(...box), Math.max(...box)]
  const scale = Math.min(
    1,
    long / Math.max(img.width, img.height),
    short / Math.min(img.width, img.height)
  )
  if (scale >= 1) return img
  const src = toMat(cv, img)
  const dst = new cv.Mat()
  try {
    const width = Math.round(img.width * scale)
    const height = Math.round(img.height * scale)
    cv.resize(src, dst, new cv.Size(width, height), 0, 0, cv.INTER_AREA)
    return { width, height, data: new Uint8ClampedArray(dst.data) }
  } finally {
    src.delete()
    dst.delete()
  }
}

async function main(): Promise<void> {
  const [jobsPath, outDir, fpPath, imagesPath] = process.argv.slice(2)
  if (!jobsPath || !outDir) throw new Error('usage: extract.mjs <jobs.json> <out dir>')
  const cv = await loadCv()
  const index = decodeFingerprints(
    readFileSync(fpPath ?? join(homedir(), '.config/duel-binder/scan/fingerprints.bin'))
  )
  const images = JSON.parse(
    readFileSync(imagesPath ?? join(homedir(), 'rarity-corpus/meta/images.json'), 'utf8')
  ) as { i: number; c: number }[]
  const cardOf = new Map(images.map((r) => [r.i, r.c]))
  const imagesOf = new Map<number, number[]>()
  for (const r of images) imagesOf.set(r.c, [...(imagesOf.get(r.c) ?? []), r.i])
  mkdirSync(outDir, { recursive: true })
  const log = join(outDir, 'extract.jsonl')
  const done = new Set(
    existsSync(log)
      ? readFileSync(log, 'utf8')
          .split('\n')
          .filter(Boolean)
          .map((l) => (JSON.parse(l) as { key: string }).key)
      : []
  )
  const jobs = (JSON.parse(readFileSync(jobsPath, 'utf8')) as Job[]).filter((j) => !done.has(j.key))
  let n = 0
  for (const job of jobs) {
    const t0 = performance.now()
    let status = 'none'
    let topCardId: number | null = null
    let distance: number | null = null
    let error: string | undefined
    try {
      let img = loadImage(job.path)
      img = job.fitBox ? fitBox(cv, img, job.fitBox) : fit(img, job.fitMax)
      if (job.degradeSeed !== undefined) {
        const d = degrade(cv, img, job.degradeSeed)
        img = d.frame
        if (n === 0) writeFileSync(join(outDir, `${job.key}.frame.jpg`), encode(img, 85).data)
      }
      let found = recognizeArt(cv, img, index)
      const top = found?.matches[0]
      topCardId = top ? (cardOf.get(top.imageId) ?? null) : null
      distance = top?.distance ?? null
      if (found && found.upsideDown !== null && top && distance! <= ART_MAX_DISTANCE)
        status = job.cardId == null || topCardId === job.cardId ? 'own' : 'other'
      if (status !== 'own' && job.cardId != null && imagesOf.has(job.cardId)) {
        found = recognizeArt(cv, img, index, new Set(imagesOf.get(job.cardId)))
        if (found && found.upsideDown !== null && found.matches[0]?.distance <= ART_MAX_DISTANCE)
          status = status === 'other' ? 'other' : 'forced'
        else if (status !== 'other') found = null
      }
      if (found && status !== 'none' && found.upsideDown !== null)
        writeFileSync(join(outDir, `${job.key}.jpg`), encode(found.card, 95).data)
      else status = status === 'other' ? 'other' : 'none'
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
      status = 'error'
    }
    appendFileSync(
      log,
      JSON.stringify({
        key: job.key,
        status,
        topCardId,
        distance,
        ms: Math.round(performance.now() - t0),
        error
      }) + '\n'
    )
    if (++n % 25 === 0) console.log(`${n}/${jobs.length}`)
  }
  console.log(`done ${n}`)
}

await main()
