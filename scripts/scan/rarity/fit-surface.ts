// Fits the whole-card foil model in src/shared/scan/surface.ts: a class-balanced, L2-regularized
// logistic regression over the logs of the surface measurements (vision/foil.ts) of upright
// cards, plus whether the frame is Xyz or Link. Positives are Starlight and Quarter Century
// Secret; negatives the rarities whose frame is plain card stock. Pendulum frames are left out.
// Prints the MODEL constants and each source's AUC.
//
//   node out/rarity/fit-surface.mjs <train items.json>... [--test <items.json>...]
//
// The shipped model was fitted on the eBay photos (with flatbed scans) and the degraded
// Yugipedia and TCGplayer scans, and tested on the webcam shots and the webcam-sized eBay photos.
import { readFileSync } from 'node:fs'
import { rarityFamily } from '@shared/scan/rarity'
import type { SurfaceReading } from '@shared/scan/surface'
import { surface } from '../../../src/renderer/src/features/scan/vision/foil'
import { loadImage } from './load'

const POSITIVE = new Set(['Starlight Rare', 'Quarter Century Secret Rare'])
const NEGATIVE = new Set([
  'Common',
  'Short Print',
  'Rare',
  'Super Rare',
  'Ultra Rare',
  'Secret Rare',
  'Prismatic Secret Rare',
  'Ghost Rare'
])
const KEYS: (keyof SurfaceReading)[] = ['frameFloor', 'frameCoarse', 'textEdges', 'textFine']
const LOG_OFFSET = 0.5
const L2 = 0.01
const STEPS = 3000
const RATE = 0.1

interface Item {
  upright: string
  rarity: string
  frameType: string
  source: string
  overframe?: boolean
}

interface Sample {
  x: number[]
  y: 0 | 1
  source: string
}

function samples(paths: string[]): Sample[] {
  const out: Sample[] = []
  for (const path of paths)
    for (const item of JSON.parse(readFileSync(path, 'utf8')) as Item[]) {
      const family = rarityFamily(item.rarity)
      const y = POSITIVE.has(family) ? 1 : NEGATIVE.has(family) ? 0 : null
      if (y === null || item.overframe || item.frameType.endsWith('_pendulum')) continue
      const r = surface(loadImage(item.upright))
      out.push({
        x: [
          ...KEYS.map((k) => Math.log(r[k] + LOG_OFFSET)),
          item.frameType === 'xyz' ? 1 : 0,
          item.frameType === 'link' ? 1 : 0
        ],
        y,
        source: item.source
      })
    }
  return out
}

function fit(train: Sample[]): { w: number[]; b: number; mean: number[]; spread: number[] } {
  const d = train[0].x.length
  const mean = Array.from(
    { length: d },
    (_, j) => train.reduce((s, t) => s + t.x[j], 0) / train.length
  )
  const spread = mean.map((m, j) =>
    Math.max(1e-6, Math.sqrt(train.reduce((s, t) => s + (t.x[j] - m) ** 2, 0) / train.length))
  )
  const z = train.map((t) => t.x.map((v, j) => (v - mean[j]) / spread[j]))
  const positives = train.filter((t) => t.y).length
  const weight = train.map((t) => (t.y ? 0.5 / positives : 0.5 / (train.length - positives)))
  const w = new Array<number>(d).fill(0)
  let b = 0
  for (let step = 0; step < STEPS; step++) {
    const gw = new Array<number>(d).fill(0)
    let gb = 0
    z.forEach((row, i) => {
      const p = 1 / (1 + Math.exp(-(row.reduce((s, v, j) => s + v * w[j], 0) + b)))
      const e = (p - train[i].y) * weight[i]
      row.forEach((v, j) => (gw[j] += e * v))
      gb += e
    })
    for (let j = 0; j < d; j++) w[j] -= RATE * (gw[j] + L2 * w[j])
    b -= RATE * gb
  }
  return { w, b, mean, spread }
}

function auc(scores: { s: number; y: number }[]): number {
  const pos = scores.filter((t) => t.y).map((t) => t.s)
  const neg = scores.filter((t) => !t.y).map((t) => t.s)
  let wins = 0
  for (const p of pos) for (const n of neg) wins += p > n ? 1 : p === n ? 0.5 : 0
  return wins / (pos.length * neg.length || 1)
}

const args = process.argv.slice(2)
const at = args.indexOf('--test')
const train = samples(at === -1 ? args : args.slice(0, at))
const test = at === -1 ? [] : samples(args.slice(at + 1))
const model = fit(train)
const score = (t: Sample): number =>
  t.x.reduce((s, v, j) => s + (model.w[j] * (v - model.mean[j])) / model.spread[j], model.b)
const names = [...KEYS, 'xyz', 'link']
const round = (v: number): number => Math.round(v * 10000) / 10000
console.log(
  JSON.stringify(
    {
      weights: Object.fromEntries(names.map((n, j) => [n, round(model.w[j])])),
      bias: round(model.b),
      mean: Object.fromEntries(names.map((n, j) => [n, round(model.mean[j])])),
      spread: Object.fromEntries(names.map((n, j) => [n, round(model.spread[j])]))
    },
    null,
    2
  )
)
for (const source of new Set([...train, ...test].map((t) => t.source))) {
  const of = [...train, ...test].filter((t) => t.source === source)
  console.log(
    `${source}: ${of.length} cards, AUC ${auc(of.map((t) => ({ s: score(t), y: t.y }))).toFixed(3)}`
  )
}
