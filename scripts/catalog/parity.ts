/**
 * Nightly parity gate: every printing pkey (of every game, reported per game) in catalog-work/work.sqlite must exist on the portal.
 * The portal may hold more (rows contributed by users); only missing ones fail.
 *
 *   npm run catalog:parity
 *
 * Env: PORTAL_URL, PORTAL_ADMIN_TOKEN. Prints the missing count and the first 50, exits 1 if any.
 */
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { openDatabase } from '../../src/main/db/database'
import type { SqlDb } from '../../src/main/db/sql'

const GAMES = ['ygo', 'pkm']
const PAGE_SIZE = 5000
const SHOW = 50

export type PkeyPage = { pkeys: string[]; more: boolean }

/** Local printing pkeys the server's list does not contain, per game. `fetchPage` gets the last pkey of the previous page. */
export async function missingPkeysByGame(
  local: SqlDb,
  fetchPage: (after: string | null) => Promise<PkeyPage>
): Promise<Record<string, string[]>> {
  const server = new Set<string>()
  let after: string | null = null
  for (;;) {
    const page: PkeyPage = await fetchPage(after)
    for (const k of page.pkeys) server.add(k)
    if (!page.more) break
    if (page.pkeys.length === 0)
      throw new Error('Portal reported more pkeys but sent an empty page')
    after = page.pkeys[page.pkeys.length - 1]
  }
  const rows = local
    .prepare('SELECT pkey, game FROM card_printings WHERE pkey IS NOT NULL')
    .all() as { pkey: string; game: string }[]
  const out: Record<string, string[]> = Object.fromEntries(GAMES.map((g) => [g, []]))
  for (const r of rows) if (!server.has(r.pkey)) (out[r.game] ??= []).push(r.pkey)
  return out
}

/** Local printing pkeys the server's list does not contain, across games. */
export async function missingPkeys(
  local: SqlDb,
  fetchPage: (after: string | null) => Promise<PkeyPage>
): Promise<string[]> {
  return Object.values(await missingPkeysByGame(local, fetchPage)).flat()
}

function portalPager(url: string, token: string): (after: string | null) => Promise<PkeyPage> {
  const root = url.replace(/\/+$/, '')
  return async (after) => {
    const q = new URLSearchParams({ limit: String(PAGE_SIZE) })
    if (after !== null) q.set('after', after)
    const res = await fetch(`${root}/admin/catalog/pkeys?${q}`, {
      headers: { authorization: `Bearer ${token}` }
    })
    if (!res.ok) throw new Error(`/admin/catalog/pkeys failed: HTTP ${res.status}`)
    return (await res.json()) as PkeyPage
  }
}

async function main(): Promise<void> {
  const url = process.env['PORTAL_URL']
  const token = process.env['PORTAL_ADMIN_TOKEN']
  if (!url || !token) throw new Error('PORTAL_URL and PORTAL_ADMIN_TOKEN must both be set')
  const work = openDatabase(resolve('catalog-work', 'work.sqlite'))
  try {
    const byGame = await missingPkeysByGame(work, portalPager(url, token))
    if (Object.values(byGame).every((m) => m.length === 0)) {
      console.log('Parity OK: the portal has every local printing pkey')
      return
    }
    for (const [game, missing] of Object.entries(byGame)) {
      if (missing.length === 0) continue
      console.error(
        `Parity FAILED (${game}): ${missing.length} printing pkey(s) missing from the portal`
      )
      for (const k of missing.slice(0, SHOW)) console.error(`  ${k}`)
      if (missing.length > SHOW) console.error(`  ... and ${missing.length - SHOW} more`)
    }
    process.exitCode = 1
  } finally {
    work.close()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
