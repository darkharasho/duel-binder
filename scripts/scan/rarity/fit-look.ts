// Fits and evaluates the look model (src/shared/scan/look.ts) on the cues and features dump.mjs
// measured.
//
//   node out/rarity/fit-look.mjs --train <dump.jsonl>... --test <dump.jsonl>...
//        [--l2 0.01] [--mode full|options] [--folds 5] [--steps 400] [--ebay-weight 1]
//        [--min-p 0.99] [--drop name.,art.] [--loco] [--list <source>...]
//        [--outcomes <out.jsonl>] [--json <scores.jsonl>] [--write <lookModel.ts>]
//
// Held-out methodology: the train dumps are split into folds by card (cardId), so every photo,
// scan and degraded copy of a card is in the same fold; each fold's cards are scored by a model
// fitted on the others. The test dumps (the owner's webcam shots) are scored by the model fitted
// on all train dumps and never trained on; with --loco they are trained on too, each card scored
// by a model fitted without it. The temperature is fitted on the held-out scores; the pick
// threshold (--min-p, else the lowest one giving 99% precision on held-out eBay photos) is
// reported per source with round 1's rules alone and with the model after them, guarded as
// look.ts guards it (lookCandidate).
//
// Multi-frame: the degraded copies of one image (sources ending -deg, -deg2...) stand in for the
// frames of one showing; their held-out scores are averaged (mean log-odds) and decided once.
//
// lookModel.ts was written with --l2 0.01 --min-p 0.99, trained on the eBay photos (and their
// webcam-sized copies), the TCGplayer and Yugipedia scans and their degraded copies (four of each
// scan whose set code has several rarities, one of the others; three of each such eBay photo),
// tested on the owner's webcam shots; then formatted with prettier.
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import {
  candidateOf,
  LOOK_FEATURES,
  lookFamily,
  lookOdds,
  meanScores,
  withFrame,
  type LookModel
} from '@shared/scan/look'
import { cuesOver, pickRarityByCues, type RarityCues } from '@shared/scan/rarity'

interface Row {
  key: string
  source: string
  /** The image a row was made from, across its degraded copies. */
  image: string
  group: string
  rarity: string
  family: string
  available: string[]
  frameType: string
  cues: RarityCues
  x: number[]
  photo: boolean | null
}

const args = process.argv.slice(2)
const list = (flag: string): string[] => {
  const at = args.indexOf(flag)
  if (at === -1) return []
  const out: string[] = []
  for (let i = at + 1; i < args.length && !args[i].startsWith('--'); i++) out.push(args[i])
  return out
}
const opt = (flag: string, fallback: string): string => list(flag)[0] ?? fallback
const L2 = Number(opt('--l2', '0.01'))
const MODE = opt('--mode', 'full')
const FOLDS = Number(opt('--folds', '5'))
const MIN_CLASS = 20
const STEPS = Number(opt('--steps', '400'))
/** Weight of the eBay listing photos (and their copies) against the scans, in fitting. */
const EBAY_WEIGHT = Number(opt('--ebay-weight', '1'))
const DROP = opt('--drop', '').split(',').filter(Boolean)

/** Texture and highlight measures are read on a log scale. */
const LOG_OFFSET = LOOK_FEATURES.map((f) => {
  const stat = f.split('.')[1]
  if (['specular', 'bright'].includes(stat)) return 0.001
  if (['fine', 'mid', 'coarse', 'chromaFine', 'axis', 'diagonal', 'skew'].includes(stat)) return 0.5
  return 0
})
const USED = LOOK_FEATURES.map((f) => !DROP.some((d) => f.startsWith(d)))

function load(paths: string[]): Row[] {
  const rows: Row[] = []
  for (const path of paths)
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      if (!line) continue
      const r = JSON.parse(line)
      const features: number[] | null = r.features ?? null
      if (!features) continue
      const x = withFrame(features, r.frameType).map((v, j) =>
        LOG_OFFSET[j] ? Math.log(Math.max(0, v) + LOG_OFFSET[j]) : v
      )
      const base = String(r.source).replace(/-(deg\d*|small)$/, '')
      rows.push({
        key: r.key,
        source: r.photo === false ? `${r.source}-scan` : r.source,
        image: `${base}/${r.key}`,
        group: String(r.cardId ?? r.key),
        rarity: r.rarity,
        family: lookFamily(r.rarity),
        available: r.available,
        frameType: r.frameType,
        cues: r.cues,
        x,
        photo: r.photo ?? null
      })
    }
  return rows
}

/** Families a row's set code could be, distinct. */
const familiesOf = (r: Row): string[] => [...new Set(r.available.map(lookFamily))]

interface Fitted {
  classes: string[]
  mean: number[]
  spread: number[]
  w: Float64Array[]
  b: Float64Array
}

/** Multinomial logistic regression, full batch with Adam, L2 on the weights. */
/**
 * Fits on train; from init's weights, scaling and classes (a warm start, for leave-one-card-out)
 * for `steps` steps when given.
 */
function fit(train: Row[], init?: Fitted, steps = STEPS): Fitted {
  const counts = new Map<string, number>()
  for (const r of train) counts.set(r.family, (counts.get(r.family) ?? 0) + 1)
  const classes =
    init?.classes ??
    [...counts]
      .filter(([, n]) => n >= MIN_CLASS)
      .map(([f]) => f)
      .sort()
  const rows = train.filter((r) => classes.includes(r.family))
  const d = LOOK_FEATURES.length
  const mean = new Array<number>(d).fill(0)
  const spread = new Array<number>(d).fill(1)
  for (let j = 0; j < d && !init; j++) {
    mean[j] = rows.reduce((s, r) => s + r.x[j], 0) / rows.length
    spread[j] = Math.max(
      1e-6,
      Math.sqrt(rows.reduce((s, r) => s + (r.x[j] - mean[j]) ** 2, 0) / rows.length)
    )
  }
  const z = rows.map((r) => r.x.map((v, j) => (USED[j] ? (v - mean[j]) / spread[j] : 0)))
  const y = rows.map((r) => classes.indexOf(r.family))
  // Which classes each row's softmax runs over: all, or only its set code's (and the unlisted).
  const among = rows.map((r) => {
    if (MODE === 'full') return classes.map((_, k) => k)
    const ks = familiesOf(r)
      .map((f) => classes.indexOf(f))
      .filter((k) => k !== -1)
    return ks.includes(classes.indexOf(r.family)) ? ks : classes.map((_, k) => k)
  })
  const K = classes.length
  if (init) {
    mean.splice(0, d, ...init.mean)
    spread.splice(0, d, ...init.spread)
  }
  const w = classes.map((_, k) => Float64Array.from(init?.w[k] ?? new Float64Array(d)))
  const b = Float64Array.from(init?.b ?? new Float64Array(K))
  const m = classes.map(() => new Float64Array(d + 1))
  const v = classes.map(() => new Float64Array(d + 1))
  const rate = 0.05
  const weight = rows.map((r) => (r.image.startsWith('ebay/') ? EBAY_WEIGHT : 1))
  const n = weight.reduce((a, c) => a + c, 0)
  for (let step = 1; step <= steps; step++) {
    const gw = classes.map(() => new Float64Array(d))
    const gb = new Float64Array(K)
    for (let i = 0; i < rows.length; i++) {
      const ks = among[i]
      const s = ks.map((k) => {
        let t = b[k]
        const wk = w[k]
        const zi = z[i]
        for (let j = 0; j < d; j++) t += wk[j] * zi[j]
        return t
      })
      const top = Math.max(...s)
      const e = s.map((t) => Math.exp(t - top))
      const total = e.reduce((a, c) => a + c, 0)
      ks.forEach((k, q) => {
        const g = ((e[q] / total - (k === y[i] ? 1 : 0)) * weight[i]) / n
        gb[k] += g
        const gk = gw[k]
        const zi = z[i]
        for (let j = 0; j < d; j++) gk[j] += g * zi[j]
      })
    }
    for (let k = 0; k < K; k++)
      for (let j = 0; j <= d; j++) {
        const g = j < d ? gw[k][j] + L2 * w[k][j] : gb[k]
        m[k][j] = 0.9 * m[k][j] + 0.1 * g
        v[k][j] = 0.999 * v[k][j] + 0.001 * g * g
        const step_ =
          (rate * (m[k][j] / (1 - 0.9 ** step))) / (Math.sqrt(v[k][j] / (1 - 0.999 ** step)) + 1e-8)
        if (j < d) w[k][j] -= step_
        else b[k] -= step_
      }
  }
  return { classes, mean, spread, w, b }
}

function scoresOf(f: Fitted, r: Row): number[] {
  return f.classes.map((_, k) => {
    let t = f.b[k]
    for (let j = 0; j < r.x.length; j++)
      if (USED[j]) t += (f.w[k][j] * (r.x[j] - f.mean[j])) / f.spread[j]
    return t
  })
}

/** A model for look.ts from a fit, with temperature and threshold. */
function asModel(f: Fitted, temperature: number, minProbability: number): LookModel {
  const round = (x: number): number => Math.round(x * 1e4) / 1e4
  return {
    features: LOOK_FEATURES,
    logOffset: LOG_OFFSET,
    mean: f.mean.map(round),
    spread: f.spread.map(round),
    classes: f.classes,
    weights: f.w.map((wk) => [...wk].map((x, j) => (USED[j] ? round(x) : 0))),
    bias: [...f.b].map(round),
    temperature: round(temperature),
    minProbability
  }
}

// ---------------------------------------------------------------------------------------------

const train = load(list('--train'))
const test = load(list('--test'))
const multi = (r: Row): boolean => familiesOf(r).length > 1

// Held-out scores for the train rows, by card folds.
const groups = [...new Set(train.map((r) => r.group))]
const foldOf = new Map<string, number>()
// A deterministic shuffle of the cards, so folds don't follow source order.
const hash = (s: string): number => {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}
groups.sort((a, b) => hash(a) - hash(b)).forEach((g, i) => foldOf.set(g, i % FOLDS))
const held = new Map<Row, number[]>()
let classes: string[] = []
for (let k = 0; k < FOLDS; k++) {
  const f = fit(train.filter((r) => foldOf.get(r.group) !== k))
  classes = f.classes
  for (const r of train) if (foldOf.get(r.group) === k) held.set(r, scoresOf(f, r))
  console.error(`fold ${k + 1}/${FOLDS}`)
}
// With --loco, the test rows are fitted on too, each card's scored by a model fitted without it.
const LOCO = args.includes('--loco')
// Each is warm-started from the model fitted on the train rows alone, which never saw a test row.
const base = fit(train)
const full = LOCO ? fit([...train, ...test], base, 150) : base
if (LOCO) {
  const cards = [...new Set(test.map((r) => r.group))]
  cards.forEach((g, i) => {
    const f = fit([...train, ...test.filter((r) => r.group !== g)], base, 150)
    for (const r of test) if (r.group === g) held.set(r, scoresOf(f, r))
    if (i % 10 === 0) console.error(`card ${i + 1}/${cards.length}`)
  })
} else for (const r of test) held.set(r, scoresOf(full, r))
const asIf = (t: number): LookModel => asModel(full, t, 0)

// Temperature: the one that best predicts the held-out train rows' rarities among their options.
function nll(t: number): number {
  let s = 0
  let n = 0
  for (const r of train) {
    if (!multi(r)) continue
    const odds = lookOdds({ ...asIf(t), classes: full.classes }, held.get(r)!, r.available)
    const p = odds?.get(r.family)
    if (p === undefined) continue
    s -= Math.log(Math.max(1e-9, p))
    n++
  }
  return s / (n || 1)
}
let temperature = 1
for (let t = 0.5; t <= 4; t += 0.05) if (nll(t) < nll(temperature)) temperature = t
console.log(
  `temperature ${temperature.toFixed(2)} (held-out NLL ${nll(temperature).toFixed(3)}, at 1: ${nll(1).toFixed(3)})`
)
const model = asIf(temperature)

interface Decision {
  r1: string | null
  look: { family: string; p: number; allowed: boolean; second: string } | null
}

/** Round 1's pick, and the model's candidate (look.ts) from held-out scores. */
function decide(
  available: string[],
  frameType: string,
  cues: RarityCues,
  scores: number[]
): Decision {
  const r1 = pickRarityByCues(available, cues, frameType)
  const c = candidateOf(model, scores, available, cues, frameType)
  return {
    r1: r1.certain ? lookFamily(r1.rarity) : null,
    look: c && { family: c.family, p: c.probability, allowed: c.allowed, second: c.runnerUp }
  }
}

interface Outcome {
  key: string
  frameType: string
  source: string
  family: string
  d: Decision
}
const outcomes: Outcome[] = []
for (const r of [...train, ...test]) {
  if (!multi(r)) continue
  outcomes.push({
    key: r.key,
    frameType: r.frameType,
    source: r.source,
    family: r.family,
    d: decide(r.available, r.frameType, r.cues, held.get(r)!)
  })
}
// Multi-frame showings: the degraded copies of one image.
const showings = new Map<string, Row[]>()
for (const r of train)
  if (/-deg\d*$/.test(r.source.replace(/-scan$/, '')) && multi(r))
    showings.set(r.image, [...(showings.get(r.image) ?? []), r])
for (const rows of showings.values()) {
  if (rows.length < 2) continue
  const r = rows[0]
  const scores = meanScores(rows.map((x) => held.get(x)!))!
  const cues = cuesOver(rows.map((x) => x.cues))
  const base = r.source.replace(/-deg\d*/, '').replace(/-scan$/, '')
  const source = `${base}${r.photo === false ? '-scan' : ''}-multi${rows.length}`
  outcomes.push({
    key: r.key,
    frameType: r.frameType,
    source,
    family: r.family,
    d: decide(r.available, r.frameType, cues, scores)
  })
}

const pickOf = (d: Decision, t: number, useLook: boolean): string | null =>
  d.r1 ?? (useLook && d.look?.allowed && d.look.p >= t ? d.look.family : null)

function tally(
  of: Outcome[],
  t: number,
  useLook: boolean
): { n: number; picked: number; right: number } {
  let picked = 0
  let right = 0
  for (const o of of) {
    const p = pickOf(o.d, t, useLook)
    if (!p) continue
    picked++
    if (p === o.family) right++
  }
  return { n: of.length, picked, right }
}

const ebayHeld = outcomes.filter((o) => o.source === 'ebay')
let minP = Number(opt('--min-p', 'NaN'))
if (Number.isNaN(minP)) {
  minP = 0.999
  for (let t = 0.999; t >= 0.5; t -= 0.001) {
    const { picked, right } = tally(ebayHeld, t, true)
    if (right < 0.99 * picked) break
    minP = t
  }
}
console.log(`threshold ${minP.toFixed(3)}`)

const fmt = ({ n, picked, right }: { n: number; picked: number; right: number }): string =>
  `${String(picked).padStart(4)}/${String(n).padEnd(4)} ${((100 * picked) / (n || 1)).toFixed(0).padStart(3)}%  ${String(picked - right).padStart(3)} wrong`
const sources = [...new Set(outcomes.map((o) => o.source))].sort()
console.log(
  `\nsource              round 1                      round 1 + look (p >= ${minP.toFixed(3)})`
)
for (const s of sources) {
  const of = outcomes.filter((o) => o.source === s)
  console.log(
    `${s.padEnd(20)}${fmt(tally(of, minP, false)).padEnd(29)}${fmt(tally(of, minP, true))}`
  )
}
console.log(
  '\nlook picks (beyond round 1) in order of probability: how many before the 1st and 2nd wrong one'
)
for (const s of sources) {
  const of = outcomes
    .filter((o) => o.source === s && !o.d.r1 && o.d.look?.allowed)
    .sort((a, b) => b.d.look!.p - a.d.look!.p)
  const wrong = of.flatMap((o, i) => (o.d.look!.family === o.family ? [] : [i]))
  const at = (k: number): string =>
    wrong.length > k ? `${wrong[k]} (p ${of[wrong[k]].d.look!.p.toFixed(4)})` : `all ${of.length}`
  console.log(
    `${s.padEnd(20)} n ${String(outcomes.filter((o) => o.source === s).length).padEnd(5)} r1 ${String(
      tally(
        outcomes.filter((o) => o.source === s),
        1,
        false
      ).picked
    ).padEnd(4)} 1st: ${at(0).padEnd(18)} 2nd: ${at(1)}`
  )
}
for (const s of list('--list')) {
  console.log(`\nlook picks on ${s}, most probable first:`)
  outcomes
    .filter((o) => o.source === s && !o.d.r1 && o.d.look?.allowed)
    .sort((a, b) => b.d.look!.p - a.d.look!.p)
    .slice(0, 40)
    .forEach((o) =>
      console.log(
        `  ${o.d.look!.p.toFixed(4)} ${o.d.look!.family === o.family ? 'ok   ' : 'WRONG'} ${o.family} as ${o.d.look!.family}  ${o.key}`
      )
    )
}
console.log('\nper rarity (all sources but multi-frame): round 1 -> with look')
const single = outcomes.filter((o) => !o.source.includes('-multi'))
for (const fam of [...new Set(single.map((o) => o.family))].sort()) {
  const of = single.filter((o) => o.family === fam)
  console.log(
    `${fam.padEnd(30)}${fmt(tally(of, minP, false)).padEnd(29)}${fmt(tally(of, minP, true))}`
  )
}
console.log('\nwrong picks with the look:')
for (const o of outcomes) {
  const p = pickOf(o.d, minP, true)
  if (p && p !== o.family)
    console.log(
      `  ${o.source} ${o.key}: ${o.family} picked as ${p} (${o.d.r1 ? 'round 1' : `p ${o.d.look!.p.toFixed(3)}`})`
    )
}
console.log('\neBay held-out precision by threshold (round 1 + look):')
for (const t of [0.8, 0.9, 0.95, 0.97, 0.98, 0.99, 0.995, 0.999]) {
  const parts = ['ebay', 'ebay-small', 'owner', 'tcgplayer-deg', 'yugipedia-deg'].map((s) => {
    const r = tally(
      outcomes.filter((o) => o.source === s),
      t,
      true
    )
    return `${s} ${r.picked}/${r.n} ${r.picked - r.right}w`
  })
  console.log(`  ${t}: ${parts.join(', ')}`)
}

const outcomesPath = opt('--outcomes', '')
if (outcomesPath)
  writeFileSync(outcomesPath, outcomes.map((o) => JSON.stringify(o)).join('\n') + '\n')
const jsonPath = opt('--json', '')
if (jsonPath) {
  writeFileSync(jsonPath, '')
  for (const r of [...train, ...test])
    appendFileSync(
      jsonPath,
      JSON.stringify({
        key: r.key,
        source: r.source,
        family: r.family,
        available: r.available,
        frameType: r.frameType,
        scores: held.get(r),
        classes: full.classes
      }) + '\n'
    )
}
const writeTo = opt('--write', '')
if (writeTo) {
  const m = asModel(full, temperature, Math.round(minP * 1000) / 1000)
  writeFileSync(
    writeTo,
    `// Generated by scripts/scan/rarity/fit-look.ts; see there for how it was fitted and tested.\nimport type { LookModel } from './look'\n\nexport const LOOK_MODEL: LookModel = ${JSON.stringify(m)}\n`
  )
  console.log(`wrote ${writeTo}`)
}
void classes
