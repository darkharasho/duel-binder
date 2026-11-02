// Fits the tilt model (src/shared/scan/tilt.ts) on straightened tilt clips and reports how it does
// held out by card.
//
//   node out/rarity/fit-tilt.mjs --frames <dir> --clips <features.jsonl> --labels <labels.jsonl>
//        [--cache <rows.jsonl>] [--report <report.md>] [--write <tiltModel.ts>] [--k 3]
//        [--parity <clips>] [--fps 15]
//
// --frames holds one directory per clip: frames.jsonl (one line per extracted frame: n, good) and
// f<nnn>.jpg, the straightened card of each good frame, extracted at --fps. --clips gives each
// clip's card id, label rarity, holder and game; --labels gives its camera (source 'phone' or
// not), and drops clips a later line undid. Clips are read one at a time, so only one clip's
// frames are in memory.
//
// The frames are decoded and shrunk with shrinkCard, then read with tiltFeatures, as the scan
// worker reads them. Each clip is sampled on the runtime grid (one frame every TILT_FRAME_MS,
// the nearest within half a tick) over TILT_MS windows starting at its first straightened frame
// and every TILT_MS / 2 after; a window counts when it has TILT_MIN_FRAMES frames. Every such
// window trains; the first one is the clip's test reading, which is what the app would read.
// --cache keeps each window's reading, so a refit skips the decoding.
//
// Held out by card: every row of a card is scored by a model fitted without that card, through
// pickByTilt as the scanner decides. The report covers each pair and each game's full class list
// on webcam (trained and tested on webcam), phone (the same, on phone) and pooled (both trained,
// both tested), with the pooled model per holder; and the 10th percentile of motion over webcam
// windows, which TILT_MIN_MOTION is set from. k (features per pair) is fixed by --k, not chosen
// on these scores.
//
// --parity N reads all of N clips' frames at once and prints, per feature, the largest relative
// and absolute difference from the --clips file's values (which the spike computed on a float
// downscale of the same frames). Some features differ by tens of percent because shrinkCard
// rounds the shrunk frame to bytes. That is expected: the fit reads the same path as the scan
// worker, so the model matches the runtime rather than the clips file.
//
// The --cache rows are keyed by clip and window start only. Delete the cache after changing
// --fps, tiltFeatures or the TILT_* constants.
//
// tiltModel.ts was written with --k 3 over both cameras' clips pooled, then formatted with
// prettier. It was fitted with TILT_FRAME_MS 100 and TILT_MIN_FRAMES 10; after the grid moved to
// the live loop's 200 ms, a refit at the new constants was checked against it held out by card
// and it was kept.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { GameId } from '@shared/games/types'
import { tiltFinish, type TiltModel } from '@shared/scan/tilt'
import { shrinkCard, TILT_FEATURES, tiltFeatures } from '@shared/scan/tiltFeatures'
import { TILT_FRAME_MS, TILT_MIN_FRAMES, TILT_MS } from '@shared/scan/thresholds'
import { loadImage } from './load'
import { fitModel, heldOut, windowFrames, type TiltRow } from './tiltFit'

const args = process.argv.slice(2)
const opt = (flag: string): string | undefined => {
  const at = args.indexOf(flag)
  return at >= 0 ? args[at + 1] : undefined
}
const need = (flag: string): string => {
  const v = opt(flag)
  if (!v) throw new Error(`${flag} is required`)
  return v
}
const FRAMES = need('--frames')
const CLIPS = need('--clips')
const LABELS = need('--labels')
const CACHE = opt('--cache')
const REPORT = opt('--report')
const WRITE = opt('--write')
const K = Number(opt('--k') ?? 3)
const PARITY = opt('--parity')
const FPS = Number(opt('--fps') ?? 15)

/** Label rarities with no finish the model reads: the spec leaves them out. */
const DROP = new Set(['Gold Rare', 'EX', 'V', 'VMAX', 'VSTAR', 'Shiny', 'Amazing Rare'])
const PKM_FINISH: Record<string, string> = {
  Holo: 'Holofoil',
  'Reverse Holo': 'Reverse Holofoil',
  'Poké Ball Reverse': 'Poke Ball Pattern',
  'Master Ball Reverse': 'Master Ball Pattern'
}

interface Clip {
  key: string
  game: GameId
  card: string
  finish: string
  holder: string
  phone: boolean
  /** The clips file's own values, for --parity. */
  spike: Record<string, number>
}

interface Window {
  key: string
  start: number
  ns: number[]
  features: number[] | null
  motion: number | null
}

const readJsonl = <T>(path: string): T[] =>
  readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as T)

function loadClips(): Clip[] {
  const labels = new Map<string, { source?: string }>()
  for (const l of readJsonl<{ file?: string; undo?: string; source?: string }>(LABELS)) {
    if (l.file) labels.set(l.file.replace(/\..*/, ''), l)
    else if (l.undo) labels.delete(l.undo.replace(/\..*/, ''))
  }
  const out: Clip[] = []
  for (const r of readJsonl<Record<string, unknown>>(CLIPS)) {
    const key = String(r.key)
    const label = labels.get(key)
    const rarity = String(r.rarity)
    if (!label || r.cardId == null || !Number.isFinite(Number(r.cardId)) || DROP.has(rarity))
      continue
    const game: GameId = r.game === 'Pokémon' ? 'pkm' : 'ygo'
    out.push({
      key,
      game,
      card: `${game}:${String(r.cardId)}`,
      finish: game === 'pkm' ? (PKM_FINISH[rarity] ?? rarity) : tiltFinish('ygo', rarity),
      holder: String(r.holder),
      phone: label.source === 'phone',
      spike: r as Record<string, number>
    })
  }
  return out
}

/** A clip's straightened frame numbers, in order. */
function goodFrames(key: string): number[] {
  const path = join(FRAMES, key, 'frames.jsonl')
  if (!existsSync(path)) return []
  return readJsonl<{ n: number; good: boolean }>(path)
    .filter((r) => r.good && existsSync(frameFile(key, r.n)))
    .map((r) => r.n)
}
const frameFile = (key: string, n: number): string =>
  join(FRAMES, key, `f${String(n).padStart(3, '0')}.jpg`)

/** Window starts: the first straightened frame, then every TILT_MS / 2 while a full window fits. */
function windowStarts(ns: readonly number[]): number[] {
  if (!ns.length) return []
  const first = (ns[0] * 1000) / FPS
  const last = (ns[ns.length - 1] * 1000) / FPS
  const out: number[] = []
  // Full: the window's last grid time has a frame within half a tick of the clip's end.
  for (
    let s = first;
    s + TILT_MS - TILT_FRAME_MS <= last + TILT_FRAME_MS / 2 + 1e-6;
    s += TILT_MS / 2
  )
    out.push(s)
  return out
}

const round = (v: number): number => Number(v.toPrecision(7))

/** Every clip's windows, from the cache where it has them, decoding the rest one clip at a time. */
function readWindows(clips: readonly Clip[]): Map<string, Window[]> {
  const cached = new Map<string, Window>()
  if (CACHE && existsSync(CACHE))
    for (const w of readJsonl<Window>(CACHE)) cached.set(`${w.key}@${w.start}`, w)
  const out = new Map<string, Window[]>()
  const t0 = Date.now()
  let done = 0
  let decoded = 0
  for (const clip of clips) {
    const ns = goodFrames(clip.key)
    const frames = new Map<number, Uint8Array>()
    const windows: Window[] = []
    for (const start of windowStarts(ns)) {
      const id = `${clip.key}@${round(start)}`
      const hit = cached.get(id)
      if (hit) {
        windows.push(hit)
        continue
      }
      const pick = windowFrames(ns, FPS, start, TILT_MS, TILT_FRAME_MS)
      let w: Window = { key: clip.key, start: round(start), ns: pick, features: null, motion: null }
      if (pick.length >= TILT_MIN_FRAMES) {
        for (const n of pick)
          if (!frames.has(n)) frames.set(n, shrinkCard(loadImage(frameFile(clip.key, n))))
        const r = tiltFeatures(
          pick.map((n) => frames.get(n)!),
          clip.game
        )
        if (r) {
          w = {
            ...w,
            features: r.features.map((v) => (Number.isFinite(v) ? round(v) : 0)),
            motion: round(r.motion)
          }
        }
      }
      decoded++
      if (CACHE) appendFileSync(CACHE, JSON.stringify(w) + '\n')
      windows.push(w)
    }
    out.set(clip.key, windows)
    done++
    if (decoded && done % 10 === 0) {
      const s = (Date.now() - t0) / 1000
      console.error(`${done}/${clips.length} clips, ${decoded} windows read, ${s.toFixed(0)} s`)
    }
  }
  return out
}

/** Per feature, the largest difference between tiltFeatures over all of a clip's frames and the spike's. */
function parity(clips: readonly Clip[], n: number): void {
  const usable = clips.filter((c) => goodFrames(c.key).length >= 25)
  const step = Math.max(1, Math.floor(usable.length / n))
  const pick = usable.filter((_, i) => i % step === 0).slice(0, n)
  const worst = TILT_FEATURES.map(() => ({ rel: 0, abs: 0, ok: true, at: '' }))
  for (const clip of pick) {
    const t = Date.now()
    const frames = goodFrames(clip.key).map((f) => shrinkCard(loadImage(frameFile(clip.key, f))))
    const r = tiltFeatures(frames, clip.game)
    if (!r) continue
    const s = clip.spike
    const spike: Record<string, number> = {
      ...s,
      nameHueR: s.nameHueR ?? 0,
      artVsText: s.artMean / Math.max(1, s.textMean),
      artVsBorder: (s.rxart ?? 0) / Math.max(1e-6, s.rxborder ?? 0),
      textVsBorder: (s.rxtext ?? 0) / Math.max(1e-6, s.rxborder ?? 0)
    }
    TILT_FEATURES.forEach((f, i) => {
      const a = r.features[i]
      const b = spike[f] ?? 0
      const abs = Math.abs(a - b)
      const rel = abs / Math.max(Math.abs(b), 1e-9)
      const w = worst[i]
      if (rel > w.rel) w.rel = rel
      if (abs > w.abs) w.abs = abs
      // Within tolerance when either is small enough.
      if (!(rel <= 0.01 || abs <= 0.01)) {
        w.ok = false
        w.at = `${clip.game} ${a.toFixed(4)} vs ${b.toFixed(4)}`
      }
    })
    console.error(
      `${clip.game} clip, ${frames.length} frames, ${((Date.now() - t) / 1000).toFixed(1)} s`
    )
  }
  console.log(`Parity over ${pick.length} clips (largest difference per feature):`)
  console.log('| feature | max relative | max absolute | within 1% or 0.01 |\n|---|---|---|---|')
  TILT_FEATURES.forEach((f, i) => {
    const w = worst[i]
    console.log(
      `| ${f} | ${(w.rel * 100).toFixed(3)}% | ${w.abs.toFixed(4)} | ${w.ok ? 'yes' : `NO (${w.at})`} |`
    )
  })
}

const pct = (p: number, v: number[]): number => {
  const s = [...v].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0
}
const cell = ({ right, total }: { right: number; total: number }): string =>
  total ? `${((right / total) * 100).toFixed(0)}% (${right}/${total})` : '-'

function main(): void {
  const clips = loadClips()
  if (PARITY) {
    parity(clips, Number(PARITY))
    return
  }
  const windows = readWindows(clips)
  const usable = (w: Window): boolean => !!w.features && w.ns.length >= TILT_MIN_FRAMES

  const lines: string[] = []
  const log = (s = ''): void => {
    lines.push(s)
    console.log(s)
  }
  log('# Tilt model fit')
  log()
  log(
    `k = ${K} features per pair (fixed, not chosen on these scores). Windows of ${TILT_MS} ms on a ${TILT_FRAME_MS} ms grid, at least ${TILT_MIN_FRAMES} frames; training on every window starting each ${TILT_MS / 2} ms from the first straightened frame, testing on the first. Held out by card; a held-out row is right when pickByTilt among the listed finishes names its finish (no pick counts as wrong). Webcam and phone columns train and test on that camera alone ('-' when it has fewer than two of the finishes); pooled trains on both; the pooled-model columns split the pooled scores by camera and holder. Baseline: the largest class's share.`
  )

  const motionWeb = clips
    .filter((c) => !c.phone)
    .flatMap((c) =>
      windows
        .get(c.key)!
        .filter(usable)
        .map((w) => w.motion!)
    )
  const motionPhone = clips
    .filter((c) => c.phone)
    .flatMap((c) =>
      windows
        .get(c.key)!
        .filter(usable)
        .map((w) => w.motion!)
    )
  const minMotion = pct(0.1, motionWeb)
  log()
  log('## Motion')
  log()
  log(
    `Webcam windows: ${motionWeb.length}, 10th percentile ${minMotion.toFixed(2)}, median ${pct(0.5, motionWeb).toFixed(2)}. Phone windows: ${motionPhone.length}, 10th percentile ${pct(0.1, motionPhone).toFixed(2)}, median ${pct(0.5, motionPhone).toFixed(2)}.`
  )

  const models: Partial<Record<GameId, TiltModel>> = {}
  for (const game of ['ygo', 'pkm'] as const) {
    const gameClips = clips.filter((c) => c.game === game)
    const train: (TiltRow & { phone: boolean; holder: string })[] = []
    const test: (TiltRow & { phone: boolean; holder: string; motion: number })[] = []
    let noWindow = 0
    for (const c of gameClips) {
      const ws = windows.get(c.key)!
      const base = { card: c.card, finish: c.finish, clip: c.key, phone: c.phone, holder: c.holder }
      for (const w of ws.filter(usable)) train.push({ ...base, x: w.features! })
      if (ws[0] && usable(ws[0])) test.push({ ...base, x: ws[0].features!, motion: ws[0].motion! })
      else noWindow++
    }
    const model = fitModel(train, K)
    models[game] = model
    const C = model.classes

    log()
    log(`## ${game}`)
    log()
    log(
      `${gameClips.length} clips of kept rarities; ${test.length} with a usable first window (${noWindow} without); ${train.length} training windows. First windows below the motion threshold: ${test.filter((r) => !r.phone && r.motion < minMotion).length} of ${test.filter((r) => !r.phone).length} webcam.`
    )
    log()
    log('| finish | webcam clips/cards | phone clips/cards | in model |\n|---|---|---|---|')
    for (const f of [...new Set(test.map((r) => r.finish))].sort()) {
      const n = (phone: boolean): string => {
        const rs = test.filter((r) => r.finish === f && r.phone === phone)
        return `${rs.length}/${new Set(rs.map((r) => r.card)).size}`
      }
      log(`| ${f} | ${n(false)} | ${n(true)} | ${C.includes(f) ? 'yes' : 'no'} |`)
    }

    const sets: string[][] = []
    for (let i = 0; i < C.length; i++)
      for (let j = i + 1; j < C.length; j++) sets.push([C[i], C[j]])
    sets.push([...C])
    const web = (r: { phone: boolean }): boolean => !r.phone
    const phone = (r: { phone: boolean }): boolean => r.phone
    const all = (): boolean => true
    const pooledBy = (keep: (r: (typeof test)[number]) => boolean, fs: string[]): string =>
      cell(heldOut(train, test.filter(keep), fs, K))
    /** Trained and tested on one camera's clips; '-' when that camera has fewer than two of the finishes. */
    const own = (keep: (r: { phone: boolean }) => boolean, fs: string[]): string =>
      new Set(test.filter((r) => keep(r) && fs.includes(r.finish)).map((r) => r.finish)).size < 2
        ? '-'
        : cell(heldOut(train.filter(keep), test.filter(keep), fs, K))
    log()
    log(
      '| finishes | baseline (pooled) | webcam | phone | pooled | pooled model, webcam clips | pooled model, phone clips | pooled, bare | pooled, sleeve |'
    )
    log('|---|---|---|---|---|---|---|---|---|')
    for (const fs of sets) {
      const inSet = test.filter((r) => fs.includes(r.finish))
      const most = Math.max(...fs.map((f) => inSet.filter((r) => r.finish === f).length))
      log(
        `| ${fs.length === C.length && fs.length > 2 ? `all ${fs.length}: ` : ''}${fs.join(' / ')} | ${cell({ right: most, total: inSet.length })} | ${own(web, fs)} | ${own(phone, fs)} | ${pooledBy(all, fs)} | ${pooledBy(web, fs)} | ${pooledBy(phone, fs)} | ${pooledBy((r) => r.holder === 'bare', fs)} | ${pooledBy((r) => r.holder === 'sleeve', fs)} |`
      )
    }
    log()
    log('Shipped pairs (pooled fit) read:')
    for (const p of model.pairs)
      log(`- ${p.a} / ${p.b}: ${p.use.map((i) => model.features[i]).join(', ')}`)
  }

  if (REPORT) writeFileSync(REPORT, lines.join('\n') + '\n')
  if (WRITE) {
    const flags = `--k ${K} --fps ${FPS}`
    writeFileSync(
      WRITE,
      `// Generated by scripts/scan/rarity/fit-tilt.ts (${flags}, both cameras pooled); see there for how it was fitted and tested.\nimport type { GameId } from '../games/types'\nimport type { TiltModel } from './tilt'\n\nexport const TILT_MODELS: Partial<Record<GameId, TiltModel>> = ${JSON.stringify(models, (_, v) => (typeof v === 'number' ? round(v) : v))}\n`
    )
  }
  console.log(`\nTILT_MIN_MOTION (webcam 10th percentile): ${minMotion.toFixed(2)}`)
}

main()
