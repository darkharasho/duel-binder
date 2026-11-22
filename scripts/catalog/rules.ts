/**
 * Builds the Yu-Gi-Oh! deck rules pack (banlists and unreleased cards, see
 * src/shared/decks/pack.ts) from YGOPRODeck and uploads it to the portal, where apps fetch it as
 * its own file, apart from the catalog pull.
 *
 *   npm run catalog:rules                Env: PORTAL_URL, PORTAL_ADMIN_TOKEN
 *   npm run catalog:rules -- --dry-run   Writes out/rules-ygo.json, prints its sizes, no upload
 *
 * Exits 1 on any failure.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { gzipSync } from 'node:zlib'
import { parseRulesPack } from '../../src/shared/decks/pack'
import { buildYgoPack, type YgoPackCard } from '../../src/shared/decks/ygo/buildPack'

const CARD_INFO_URL = 'https://db.ygoprodeck.com/api/v7/cardinfo.php?misc=yes'
const TIMEOUT_MS = 120_000

async function fetchCards(): Promise<YgoPackCard[]> {
  const res = await fetch(CARD_INFO_URL, { signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!res.ok) throw new Error(`YGOPRODeck cardinfo answered ${res.status}`)
  const body = (await res.json()) as { data?: unknown }
  if (!Array.isArray(body.data)) throw new Error('YGOPRODeck cardinfo has no data array')
  return body.data as YgoPackCard[]
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run')
  const portalUrl = process.env['PORTAL_URL']
  const token = process.env['PORTAL_ADMIN_TOKEN']
  if (!dryRun && (!portalUrl || !token))
    throw new Error('PORTAL_URL and PORTAL_ADMIN_TOKEN must both be set')

  const pack = buildYgoPack(await fetchCards(), new Date())
  if (parseRulesPack(pack).state !== 'ready') throw new Error('The built rules pack is not valid')
  const json = JSON.stringify(pack)
  const bytes = Buffer.byteLength(json)
  const gz = gzipSync(json).length

  if (dryRun) {
    mkdirSync('out', { recursive: true })
    writeFileSync('out/rules-ygo.json', json)
    console.log(
      `rules pack ${pack.version}: ${bytes} bytes, ${gz} bytes gzipped (dry run, not uploaded)`
    )
    return
  }
  const res = await fetch(`${portalUrl}/api/admin/rules/ygo`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: json,
    signal: AbortSignal.timeout(TIMEOUT_MS)
  })
  if (!res.ok) throw new Error(`Portal refused the rules pack: ${res.status} ${await res.text()}`)
  console.log(`rules pack ${pack.version} uploaded: ${bytes} bytes, ${gz} bytes gzipped`)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e)
    process.exit(1)
  })
}
