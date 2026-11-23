/**
 * Builds the Yu-Gi-Oh! deck rules pack (banlists and unreleased cards, see
 * src/shared/decks/pack.ts) from YGOPRODeck and uploads it to the portal, where apps fetch it as
 * its own file, apart from the catalog pull.
 *
 *   npm run catalog:rules                Env: PORTAL_URL, PORTAL_ADMIN_TOKEN
 *   npm run catalog:rules -- --dry-run   Writes out/rules-ygo.json, prints its sizes, no upload
 *   npm run catalog:rules -- --game pkm [--cache <path>] [--dry-run]
 *                                        The Pokémon pack, from the catalog stage's card cache
 *                                        (default catalog-work/pokemon-src.sqlite)
 *   npm run catalog:rules -- --game op [--dry-run]
 *                                        The One Piece pack, from the hand-kept
 *                                        src/shared/decks/rules/onepiece.json (no cache, no network)
 *
 *   npm run catalog:rules -- --game mtg [--dry-run]
 *                                        The Magic pack, from Scryfall's oracle_cards bulk file
 *                                        (about 160 MB, streamed; no cache)
 *
 * Exits 1 on any failure.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { gzipSync } from 'node:zlib'
import Database from 'better-sqlite3'
import { parseRulesPack, type MtgRulesPack, type RulesPack } from '../../src/shared/decks/pack'
import opRules from '../../src/shared/decks/rules/onepiece.json'
import manual from '../../src/shared/decks/rules/pokemon-manual.json'
import {
  buildPkmPack,
  type PkmManual,
  type PkmPackCard
} from '../../src/shared/decks/pokemon/buildPack'
import { buildOpPack, type OpRulesFile } from '../../src/shared/decks/onepiece/buildPack'
import { buildMtgPack, type MtgPackCard } from '../../src/shared/decks/magic/buildPack'
import { createScryfall } from './magic/scryfall'
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

/** The English cards in the Pokémon stage's cache, as the pack builder reads them. */
export function readEnglishCards(cachePath: string): PkmPackCard[] {
  const db = new Database(cachePath, { readonly: true })
  try {
    const rows = db.prepare("SELECT json FROM td_cards WHERE lang = 'en'").all() as {
      json: string
    }[]
    // TCGdex leaves a few old attacks and abilities unnamed (dp6-136, dp2-116): they name nothing,
    // so they're left out of the card key. A card with no name can't be keyed at all.
    const named = (xs?: { name?: unknown }[]): { name: string }[] | undefined =>
      xs?.flatMap((a) => (typeof a.name === 'string' ? [{ name: a.name }] : []))
    return rows.flatMap(({ json }) => {
      const c = JSON.parse(json) as PkmPackCard & { attacks?: { name?: unknown }[] }
      if (typeof c.name !== 'string') return []
      return [
        {
          id: c.id,
          name: c.name,
          category: c.category,
          stage: c.stage,
          rarity: c.rarity,
          energyType: c.energyType,
          legal: c.legal,
          attacks: named(c.attacks),
          abilities: named(c.abilities)
        }
      ]
    })
  } finally {
    db.close()
  }
}

async function publish(game: 'ygo' | 'pkm' | 'op' | 'mtg', pack: RulesPack): Promise<void> {
  const dryRun = process.argv.includes('--dry-run')
  const portalUrl = process.env['PORTAL_URL']
  const token = process.env['PORTAL_ADMIN_TOKEN']
  if (!dryRun && (!portalUrl || !token))
    throw new Error('PORTAL_URL and PORTAL_ADMIN_TOKEN must both be set')
  if (parseRulesPack(pack).state !== 'ready') throw new Error('The built rules pack is not valid')
  const json = JSON.stringify(pack)
  const bytes = Buffer.byteLength(json)
  const gz = gzipSync(json).length

  if (dryRun) {
    mkdirSync('out', { recursive: true })
    writeFileSync(`out/rules-${game}.json`, json)
    console.log(
      `rules pack ${pack.version}: ${bytes} bytes, ${gz} bytes gzipped (dry run, not uploaded)`
    )
    return
  }
  const res = await fetch(`${portalUrl}/api/admin/rules/${game}`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: json,
    signal: AbortSignal.timeout(TIMEOUT_MS)
  })
  if (!res.ok) throw new Error(`Portal refused the rules pack: ${res.status} ${await res.text()}`)
  console.log(`rules pack ${pack.version} uploaded: ${bytes} bytes, ${gz} bytes gzipped`)
}

/** The fields buildMtgPack reads from one Scryfall oracle object, nothing more (faces included). */
export function toMtgPackCard(raw: unknown): MtgPackCard {
  const c = raw as MtgPackCard
  const face = (
    f: NonNullable<MtgPackCard['card_faces']>[number]
  ): NonNullable<MtgPackCard['card_faces']>[number] => ({
    name: f.name,
    type_line: f.type_line,
    oracle_text: f.oracle_text,
    power: f.power,
    toughness: f.toughness
  })
  return {
    name: c.name,
    layout: c.layout,
    type_line: c.type_line,
    oracle_text: c.oracle_text,
    keywords: c.keywords,
    power: c.power,
    toughness: c.toughness,
    legalities: c.legalities,
    released_at: c.released_at,
    reprint: c.reprint,
    card_faces: c.card_faces?.map(face)
  }
}

async function buildMtg(): Promise<MtgRulesPack> {
  const scry = createScryfall({ version: 'rules' })
  const info = await scry.bulkInfo('oracle_cards')
  const cards: MtgPackCard[] = []
  for await (const raw of scry.rawObjects(info.downloadUri)) cards.push(toMtgPackCard(raw))
  return buildMtgPack(cards, { version: info.updatedAt, builtAt: new Date() })
}

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function main(): Promise<void> {
  const game = argValue('--game') ?? 'ygo'
  if (game === 'pkm') {
    const cache = argValue('--cache') ?? 'catalog-work/pokemon-src.sqlite'
    await publish('pkm', buildPkmPack(readEnglishCards(cache), manual as PkmManual, new Date()))
  } else if (game === 'op') {
    await publish('op', buildOpPack(opRules as OpRulesFile, new Date()))
  } else if (game === 'mtg') {
    await publish('mtg', await buildMtg())
  } else if (game === 'ygo') {
    await publish('ygo', buildYgoPack(await fetchCards(), new Date()))
  } else {
    throw new Error(`Unknown --game ${game}; expected ygo, pkm, op or mtg`)
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e)
    process.exit(1)
  })
}
