/**
 * Pulls the testers' training photos and their truth file from the portal:
 *
 *   PORTAL_URL=… PORTAL_ADMIN_TOKEN=… npm run scan:pull-training -- [--game op] [--out ~/scan-capture]
 *
 * Photos land in <out>/shots-<game>/<clientId>.jpg, only the ones not already there, and
 * <out>/<game>-truth.json is written once every download has succeeded. Photos a tester has since
 * deleted are reported, never removed. Built by Vite (scripts/catalog/vite.config.ts) because it
 * imports src/shared.
 */
import { mkdirSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  CLIENT_ID_RE,
  truthRowOf,
  type TrainingLabelRow,
  type TruthRow
} from '../../src/shared/training'

const PAGE = 500
const CONCURRENCY = 2

export interface PullPlan {
  download: TrainingLabelRow[]
  truth: TruthRow[]
  stale: string[]
}

/** What to fetch and write, given every label and the file names already on disk. */
export function planPull(labels: TrainingLabelRow[], have: ReadonlySet<string>): PullPlan {
  const download: TrainingLabelRow[] = []
  const truth: TruthRow[] = []
  const named = new Set<string>()
  for (const l of [...labels].sort((a, b) => a.id - b.id)) {
    if (!CLIENT_ID_RE.test(l.clientId)) {
      console.warn(`skipping label ${l.id}: bad client id`)
      continue
    }
    const name = `${l.clientId}.jpg`
    named.add(name)
    truth.push(truthRowOf(l))
    if (!have.has(name)) download.push(l)
  }
  return { download, truth, stale: [...have].filter((n) => !named.has(n)).sort() }
}

interface Portal { url: string; token: string }

/** The truth rows minus the photos that were gone by download time. */
export function withoutSkipped(truth: TruthRow[], skipped: ReadonlySet<string>): TruthRow[] {
  return truth.filter((t) => !skipped.has(t.file))
}

async function get(p: Portal, path: string, okMissing = false): Promise<Response | null> {
  const res = await fetch(`${p.url.replace(/\/+$/, '')}${path}`, {
    headers: { authorization: `Bearer ${p.token}` }
  })
  if (okMissing && res.status === 404) return null
  if (!res.ok) throw new Error(`${path}: ${res.status}`)
  return res
}

async function allLabels(p: Portal, game: string): Promise<TrainingLabelRow[]> {
  const all: TrainingLabelRow[] = []
  let after = 0
  for (;;) {
    const res = await get(
      p,
      `/admin/training/labels?game=${encodeURIComponent(game)}&after=${after}&limit=${PAGE}`
    )
    const page = (await res!.json()) as { labels: TrainingLabelRow[]; more: boolean }
    all.push(...page.labels)
    if (!page.more || page.labels.length === 0) return all
    after = page.labels[page.labels.length - 1].id
  }
}

/** False when the photo was deleted since the listing (404); other failures throw. */
async function download(p: Portal, dir: string, l: TrainingLabelRow): Promise<boolean> {
  const res = await get(p, `/admin/training/photo/${l.id}`, true)
  if (!res) return false
  const file = join(dir, `${l.clientId}.jpg`)
  await writeFile(`${file}.part`, new Uint8Array(await res.arrayBuffer()))
  renameSync(`${file}.part`, file)
  return true
}

function option(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

async function main(): Promise<void> {
  const url = process.env['PORTAL_URL']
  const token = process.env['PORTAL_ADMIN_TOKEN']
  if (!url || !token) throw new Error('PORTAL_URL and PORTAL_ADMIN_TOKEN must both be set')
  const p = { url, token }
  const game = option('game', 'op')
  const out = option('out', '~/scan-capture').replace(/^~(?=$|\/)/, homedir())
  const labels = await allLabels(p, game)
  const dir = join(out, `shots-${game}`)
  mkdirSync(dir, { recursive: true })
  const have = new Set(readdirSync(dir).filter((n) => n.endsWith('.jpg')))
  const plan = planPull(labels, have)
  const queue = [...plan.download]
  const skipped = new Set<string>()
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      for (let l = queue.shift(); l; l = queue.shift()) {
        if (await download(p, dir, l)) continue
        skipped.add(truthRowOf(l).file)
        console.log(`skipped ${l.clientId}.jpg: deleted since the listing`)
      }
    })
  )
  const truth = withoutSkipped(plan.truth, skipped)
  writeFileSync(join(out, `${game}-truth.json`), JSON.stringify(truth, null, 2) + '\n')
  const holders = new Map<string, number>()
  for (const t of truth) holders.set(t.holder, (holders.get(t.holder) ?? 0) + 1)
  const by = [...holders].map(([h, n]) => `${h} ${n}`).join(', ')
  console.log(
    `${truth.length} labels, ${plan.download.length - skipped.size} downloaded, ${plan.stale.length} stale, by holder: ${by}`
  )
  if (plan.stale.length) console.log(`stale (kept): ${plan.stale.join(', ')}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
