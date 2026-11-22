/**
 * Monthly search-term harvest: looks up eBay listing titles for the priciest English printings,
 * mines them for phrases nothing explains, has Claude keep the ones collectors use, and posts what
 * is left to the portal as pending terms for the owner to approve in the Admin Terms tab.
 *
 *   npm run terms:harvest -- --mode recent|backfill --from N --count N [--dry-run]
 *
 * Env: PORTAL_URL, PORTAL_ADMIN_TOKEN, EBAY_PRICES_URL, HARVEST_TOKEN, ANTHROPIC_API_KEY.
 * --dry-run still asks Claude (it needs the key) but prints the proposals instead of posting them.
 */
import Anthropic from '@anthropic-ai/sdk'
import { rmSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { pullGame } from '../../src/main/catalog/pull'
import { inProcessApplier } from '../../src/main/catalogApplier'
import { createCloudClient } from '../../src/main/cloud/client'
import { openDatabase } from '../../src/main/db/database'
import { GAME_IDS } from '../../src/shared/games/types'
import { classify, estimateCost, type Proposal, type Usage } from './classify'
import { findCandidates, type HarvestedPrinting } from './mine'
import { harvestQuery, pickPrintings, uniqueSearches, type PrintingRef } from './targets'

/** Calls left in eBay's daily allowance that the harvest never touches. */
const QUOTA_RESERVE = 1500
const MAX_POSTED = 100

export interface Args {
  mode: 'recent' | 'backfill'
  from: number
  count: number
  dryRun: boolean
}

export function parseArgs(argv: string[]): Args {
  const args: Args = { mode: 'recent', from: 0, count: 300, dryRun: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--dry-run') args.dryRun = true
    else if (a === '--mode') {
      const v = argv[++i]
      if (v !== 'recent' && v !== 'backfill') throw new Error('--mode must be recent or backfill')
      args.mode = v
    } else if (a === '--from' || a === '--count') {
      const n = Number(argv[++i])
      if (!Number.isInteger(n) || n < 0) throw new Error(`${a} needs a whole number`)
      args[a === '--from' ? 'from' : 'count'] = n
    } else throw new Error(`Unknown argument ${a}`)
  }
  return args
}

const need = (name: string): string => {
  const v = process.env[name]
  if (!v) throw new Error(`${name} must be set`)
  return v
}

const removeDb = (file: string): void => {
  for (const f of [file, `${file}-wal`, `${file}-shm`]) rmSync(f, { force: true })
}

const describeFailures = (f: Map<number, number>): string =>
  [...f].map(([status, n]) => `${status} x${n}`).join(', ')

async function getJson<T>(
  url: string,
  headers: Record<string, string>
): Promise<{ status: number; body: T | null }> {
  const res = await fetch(url, { headers })
  return { status: res.status, body: res.ok ? ((await res.json()) as T) : null }
}

/** Pulls every game's catalog into a throwaway database, as a desktop's first pull does, and picks the printings. */
async function pickFromCatalog(
  args: Args,
  portalUrl: string,
  adminToken: string
): Promise<PrintingRef[]> {
  const dir = resolve('catalog-work')
  await mkdir(dir, { recursive: true })
  const dbFile = join(dir, 'terms.sqlite')
  removeDb(dbFile)
  const db = openDatabase(dbFile)
  try {
    const client = createCloudClient({ baseUrl: portalUrl, token: adminToken, timeoutMs: 120_000 })
    for (const game of GAME_IDS) {
      await pullGame({
        db,
        client,
        game,
        applier: inProcessApplier(db),
        set: () => {},
        snapshotDir: join(dir, 'terms-dl')
      })
      console.log(`${game}: catalog pulled`)
    }
    return pickPrintings(db, { ...args, now: new Date() })
  } finally {
    db.close()
    removeDb(dbFile)
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const portalUrl = need('PORTAL_URL').replace(/\/$/, '')
  const adminToken = need('PORTAL_ADMIN_TOKEN')
  const ebayUrl = need('EBAY_PRICES_URL').replace(/\/$/, '')
  const harvestToken = need('HARVEST_TOKEN')
  const anthropic = new Anthropic({ apiKey: need('ANTHROPIC_API_KEY') })
  const adminHeaders = { Authorization: `Bearer ${adminToken}` }

  const picked = await pickFromCatalog(args, portalUrl, adminToken)
  console.log(`Picked ${picked.length} printings (${args.mode}, from ${args.from})`)

  const quota = await getJson<{ remaining: number | null }>(`${ebayUrl}/v1/quota`, {
    'X-Client': 'duel-binder'
  })
  const remaining = quota.body?.remaining
  if (remaining == null) throw new Error('Could not read the eBay quota; not harvesting')
  const calls = Math.min(args.count, picked.length, remaining - QUOTA_RESERVE)
  if (calls <= 0) {
    console.log(`eBay quota too low (${remaining} left, ${QUOTA_RESERVE} kept back); nothing to do`)
    return
  }

  const harvested: HarvestedPrinting[] = []
  let made = 0
  let titles = 0
  const failures = new Map<number, number>()
  for (const p of uniqueSearches(picked).slice(0, calls)) {
    const q = new URLSearchParams({ q: harvestQuery(p), game: p.game })
    const res = await getJson<{ titles: { title: string; seller: string }[] }>(
      `${ebayUrl}/v1/titles?${q}`,
      { Authorization: `Bearer ${harvestToken}`, 'X-Client': 'duel-binder' }
    )
    made++
    if (res.status === 429) {
      console.log('eBay rate limit reached; stopping the harvest early')
      break
    }
    if (!res.body) {
      if (made === 1 && [401, 403, 404].includes(res.status))
        throw new Error(`The first eBay titles call got ${res.status}; check HARVEST_TOKEN and EBAY_PRICES_URL`)
      failures.set(res.status, (failures.get(res.status) ?? 0) + 1)
      continue
    }
    titles += res.body.titles.length
    harvested.push({ ...p, titles: res.body.titles })
  }

  const failed = [...failures.values()].reduce((a, b) => a + b, 0)
  if (made > 0 && failed === made) throw new Error(`Every eBay titles call failed (${describeFailures(failures)})`)

  const usage: Usage = { input: 0, output: 0 }
  const proposals: Proposal[] = []
  let candidateCount = 0
  for (const game of GAME_IDS) {
    const known = await getJson<{ keys: string[] }>(
      `${portalUrl}/admin/terms/known?game=${game}`,
      adminHeaders
    )
    if (!known.body) throw new Error(`Could not read the known terms for ${game} (${known.status})`)
    const cands = findCandidates(
      harvested.filter((h) => h.game === game),
      new Set(known.body.keys)
    )
    candidateCount += cands.length
    proposals.push(...(await classify(anthropic, game, cands, usage)))
  }
  const posted = proposals.sort((a, b) => b.evidence.sellers - a.evidence.sellers).slice(0, MAX_POSTED)

  if (args.dryRun) console.log(JSON.stringify(posted, null, 2))
  else if (posted.length > 0) {
    const res = await fetch(`${portalUrl}/admin/terms/propose`, {
      method: 'POST',
      headers: { ...adminHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({ proposals: posted })
    })
    if (!res.ok) {
      console.error(`The portal refused the proposals (${res.status}): ${await res.text().catch(() => '')}`)
      console.error(JSON.stringify(posted))
      throw new Error(`Posting the proposals failed (${res.status})`)
    }
    console.log(`Portal added ${((await res.json()) as { added: number }).added} pending terms`)
  }
  console.log(
    `Summary: ${made} eBay calls${failed ? ` (${failed} failed: ${describeFailures(failures)})` : ''}, ${titles} titles, ${candidateCount} candidates, ${proposals.length} proposals` +
      `${args.dryRun ? ' (dry run, not posted)' : ''}, Claude ${usage.input} in / ${usage.output} out tokens, ` +
      `about $${estimateCost(usage).toFixed(2)}`
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
