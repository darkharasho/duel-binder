import type Database from 'better-sqlite3'
import { movedEnough } from '../../../src/main/tcgplayer/prices'
import { pokemonId } from '../../../src/shared/games/ids'
import { matchGroup, matchProducts, type MatchedProduct } from './match'
import { cardVersions, versionSubtype, type PkmVersion } from './versions'
import type { PkmLang, PokemonSources, TcGroup, TcPrice, TcProduct, TdCard, TdSet } from './types'

/**
 * The Pokémon writer (spec "Data"): fetches and matches both languages, then writes the
 * game = 'pkm' catalog rows into the job's work database in one transaction. Every lookup and
 * write is scoped to Pokémon. Keys never move: a written card keeps its printings' set name and
 * code, a written set keeps its name and code, versions and cards are never deleted (only flagged
 * missing), and art once set is kept. Rows are only written when a value differs, and no column
 * carries a per-night timestamp, so an unchanged night diffs to nothing.
 */

export interface PokemonReport {
  lang: PkmLang
  sets: number
  cards: number
  versions: number
  priced: number
  images: number
  unmatchedSets: string[]
  unmatchedCards: number
  problems: string[]
}

export interface RefreshPokemonOpts {
  langs?: PkmLang[]
  log?: (l: string) => void
  /** The clock for `cards.updated_at` on changed cards (tests pin it). */
  now?: () => Date
}

interface CardPlan {
  card: TdCard
  name: string
  localName: string | null
  imageUrl: string | null
  versions: PkmVersion[]
}

interface SetPlan {
  set: TdSet
  /** The English name of a matched Japanese set (its TCGplayer Japan group), else null. */
  groupName: string | null
  cards: CardPlan[]
}

interface LangPlan {
  lang: PkmLang
  sets: SetPlan[]
  report: PokemonReport
}

/** A set's logo key: the portal's SET_KEY_RE only allows [A-Za-z0-9_-] (TCGdex has ids like sv03.5). */
export const setImageKey = (lang: PkmLang, setId: string): string =>
  `td-${lang}-${setId.replace(/[^A-Za-z0-9_-]/g, '_')}`

/** A group name without its leading "{code}: " ("M4: Ninja Spinner" → "Ninja Spinner"). */
const stripCode = (name: string): string => name.replace(/^\S+:\s+/, '').trim()

/** A product name without a trailing " - {number}" ("Pikachu - 001/083" → "Pikachu"). */
const stripNumber = (name: string): string => name.replace(/\s+-\s+\S*\d\S*$/, '').trim()

/** The abbreviation a set's numbers start with: TCGdex's official one, else its id in upper case. */
const setAbbrev = (s: TdSet): string => s.abbreviation?.official?.trim() || s.id.toUpperCase()

/** The printed number: "{abbrev} {localId}/{official}", or "{abbrev} {localId}" with no count. */
function printedNumber(abbrev: string, s: TdSet, localId: string): string {
  const official = s.cardCount?.official
  return typeof official === 'number' && official > 0
    ? `${abbrev} ${localId}/${official}`
    : `${abbrev} ${localId}`
}

const present = (x: unknown): x is string | number =>
  x !== undefined && x !== null && String(x).trim() !== ''

/** The card text: one line per ability, then one per attack, with empty parts left out. */
export function cardDesc(card: TdCard): string {
  const lines: string[] = []
  for (const a of card.abilities ?? []) {
    const head = [present(a.type) ? `${a.type}:` : '', a.name].filter(present).join(' ')
    lines.push(present(a.effect) ? `${head} — ${a.effect}` : head)
  }
  for (const a of card.attacks ?? []) {
    const head = [(a.cost ?? []).join(' '), a.name, present(a.damage) ? String(a.damage) : '']
      .filter(present)
      .join(' ')
    lines.push(present(a.effect) ? `${head}: ${a.effect}` : head)
  }
  return lines.filter(present).join('\n')
}

/**
 * The product a Japanese card's English name comes from: among the matched products those reached
 * without a variant subtype are preferred, then the lowest product id, so TCGCSV's order never
 * decides the name.
 */
function namingProduct(products: MatchedProduct[]): TcProduct | undefined {
  const plain = products.filter((m) => versionSubtype(m.variantSubtype) === null)
  const pool = plain.length > 0 ? plain : products
  let best: TcProduct | undefined
  for (const { product } of pool) if (!best || product.productId < best.productId) best = product
  return best
}

/** Fetches and matches one language. Throws on any source failure, before anything is written. */
async function planLanguage(
  lang: PkmLang,
  sources: PokemonSources,
  log: (l: string) => void
): Promise<LangPlan> {
  const problems: string[] = []
  const sets = await sources.sets(lang)
  const setOf = new Map<string, TdSet>()
  for (const s of sets) {
    for (const c of s.cards ?? []) {
      if (setOf.has(c.id))
        problems.push(
          `${lang}/${c.id} is listed in sets ${setOf.get(c.id)!.id} and ${s.id}; kept in the first`
        )
      else setOf.set(c.id, s)
    }
  }
  const cards = await sources.cards(lang, [...setOf.keys()])
  const cardById = new Map(cards.map((c) => [c.id, c]))
  log(`Pokémon ${lang}: ${sets.length} sets, ${cards.length} cards from TCGdex`)

  const groups: TcGroup[] = await sources.groups(lang)
  const groupById = new Map(groups.map((g) => [g.groupId, g]))
  const lists = await Promise.all(groups.map((g) => sources.products(lang, g.groupId)))
  const productById = new Map<number, TcProduct>()
  const productGroup = new Map<number, number>()
  const inGroup = new Map<number, TcProduct[]>()
  for (const p of lists.flat()) {
    if (productById.has(p.productId)) continue
    productById.set(p.productId, p)
    productGroup.set(p.productId, p.groupId)
    const list = inGroup.get(p.groupId)
    if (list) list.push(p)
    else inGroup.set(p.groupId, [p])
  }
  log(`Pokémon ${lang}: ${groups.length} TCGCSV groups, ${productById.size} products`)

  const unmatchedSets: string[] = []
  let unmatchedCards = 0
  const matched: {
    set: TdSet
    groupId: number | null
    cards: { card: TdCard; products: MatchedProduct[] }[]
  }[] = []
  for (const s of sets) {
    const setCards: TdCard[] = []
    for (const b of s.cards ?? []) {
      if (setOf.get(b.id) !== s) continue
      const c = cardById.get(b.id)
      if (c) setCards.push(c)
      else problems.push(`${lang}/${b.id}: TCGdex returned no card`)
    }
    const groupId = matchGroup(s, setCards, groups, productGroup)
    if (groupId === null) unmatchedSets.push(`${s.id} ${s.name}`)
    const out = setCards.map((card) => {
      const m = matchProducts(
        card,
        groupId,
        groupId === null ? [] : (inGroup.get(groupId) ?? []),
        productById
      )
      problems.push(...m.problems.map((p) => `${lang}/${p}`))
      if (m.products.length === 0) unmatchedCards++
      return { card, products: m.products }
    })
    matched.push({ set: s, groupId, cards: out })
  }

  // Prices only for the groups that hold a matched product.
  const priceGroups = new Set<number>()
  for (const s of matched)
    for (const c of s.cards) for (const m of c.products) priceGroups.add(m.product.groupId)
  const priceLists = await Promise.all([...priceGroups].map((g) => sources.prices(lang, g)))
  const prices = new Map<number, TcPrice[]>()
  for (const row of priceLists.flat()) {
    const list = prices.get(row.productId)
    if (list) list.push(row)
    else prices.set(row.productId, [row])
  }

  let versions = 0
  let priced = 0
  let cardCount = 0
  const planned: SetPlan[] = matched.map(({ set, groupId, cards: cs }) => {
    const group = groupId === null ? undefined : groupById.get(groupId)
    return {
      set,
      groupName: lang === 'ja' && group ? stripCode(group.name) || null : null,
      cards: cs.map(({ card, products }) => {
        const v = cardVersions(card, products, prices)
        problems.push(...v.problems.map((p) => `${lang}/${p}`))
        versions += v.versions.length
        priced += v.versions.filter((x) => x.price !== null).length
        cardCount++
        const first = namingProduct(products)
        const english = lang === 'ja' && first ? stripNumber(first.name) : ''
        const name = english || card.name
        return {
          card,
          name,
          localName: lang === 'ja' && name !== card.name ? card.name : null,
          imageUrl: card.image || first?.imageUrl || null,
          versions: v.versions
        }
      })
    }
  })

  return {
    lang,
    sets: planned,
    report: {
      lang,
      sets: sets.length,
      cards: cardCount,
      versions,
      priced,
      images: 0,
      unmatchedSets,
      unmatchedCards,
      problems
    }
  }
}

interface ExistingPrinting {
  id: number
  set_name: string
  set_code: string
  set_rarity: string
  tcg_product_id: number | null
  market_price: number | null
  missing_from_api: number
}

/** Writes the planned languages in one transaction. */
function writePlans(db: Database.Database, plans: LangPlan[], nowIso: string): void {
  const setByKey = db.prepare(
    "SELECT set_name, set_code, tcg_date, image_url FROM sets WHERE game = 'pkm' AND language = ? AND image_key = ?"
  )
  const setByName = db.prepare(
    "SELECT 1 FROM sets WHERE game = 'pkm' AND language = ? AND set_name = ?"
  )
  const insertSet = db.prepare(
    `INSERT INTO sets (game, language, set_name, set_code, tcg_date, image_url, image_key)
     VALUES ('pkm', ?, ?, ?, ?, ?, ?)`
  )
  const updateSet = db.prepare(
    "UPDATE sets SET tcg_date = ?, image_url = ? WHERE game = 'pkm' AND language = ? AND image_key = ?"
  )
  const cardRow = db.prepare(`SELECT name, type, "desc" FROM cards WHERE game = 'pkm' AND id = ?`)
  const insertCard = db.prepare(
    `INSERT INTO cards (id, name, type, frame_type, race, "desc", updated_at, game)
     VALUES (?, ?, ?, 'pokemon', '', ?, ?, 'pkm')`
  )
  const updateCard = db.prepare(
    `UPDATE cards SET name = ?, type = ?, "desc" = ?, updated_at = ? WHERE game = 'pkm' AND id = ?`
  )
  const detailsRow = db.prepare('SELECT image_url FROM pokemon_cards WHERE card_id = ?')
  const upsertDetails = db.prepare(
    `INSERT INTO pokemon_cards (card_id, category, hp, types, stage, rarity, illustrator, source_id, image_url, local_name)
     VALUES (@cardId, @category, @hp, @types, @stage, @rarity, @illustrator, @sourceId, @imageUrl, @localName)
     ON CONFLICT(card_id) DO UPDATE SET category = excluded.category, hp = excluded.hp, types = excluded.types,
       stage = excluded.stage, rarity = excluded.rarity, illustrator = excluded.illustrator,
       source_id = excluded.source_id, image_url = COALESCE(pokemon_cards.image_url, excluded.image_url),
       local_name = excluded.local_name
     WHERE pokemon_cards.category IS NOT excluded.category OR pokemon_cards.hp IS NOT excluded.hp
       OR pokemon_cards.types IS NOT excluded.types OR pokemon_cards.stage IS NOT excluded.stage
       OR pokemon_cards.rarity IS NOT excluded.rarity OR pokemon_cards.illustrator IS NOT excluded.illustrator
       OR pokemon_cards.source_id IS NOT excluded.source_id OR pokemon_cards.local_name IS NOT excluded.local_name
       OR (pokemon_cards.image_url IS NULL AND excluded.image_url IS NOT NULL)`
  )
  const upsertImage = db.prepare(
    `INSERT INTO card_images (image_id, card_id, sort_order, missing_from_api, game) VALUES (?, ?, 0, 0, 'pkm')
     ON CONFLICT(image_id) DO UPDATE SET missing_from_api = 0
     WHERE card_images.game = 'pkm' AND card_images.missing_from_api <> 0`
  )
  const printingsOf = db.prepare(
    `SELECT id, set_name, set_code, set_rarity, tcg_product_id, market_price, missing_from_api
     FROM card_printings WHERE game = 'pkm' AND card_id = ? ORDER BY id`
  )
  const insertPrinting = db.prepare(
    `INSERT INTO card_printings (card_id, set_name, set_code, set_rarity, set_rarity_code, set_price,
       missing_from_api, language, tcg_product_id, variant, market_price, game)
     VALUES (?, ?, ?, ?, '', NULL, 0, ?, ?, NULL, ?, 'pkm')`
  )
  const updatePrinting = db.prepare(
    "UPDATE card_printings SET missing_from_api = ?, tcg_product_id = ?, market_price = ? WHERE game = 'pkm' AND id = ?"
  )
  const knownCards = db.prepare(
    "SELECT card_id, source_id FROM pokemon_cards WHERE source_id LIKE ? || '/%'"
  )
  const flagPrintings = db.prepare(
    "UPDATE card_printings SET missing_from_api = 1 WHERE game = 'pkm' AND card_id = ? AND missing_from_api = 0"
  )
  const flagImages = db.prepare(
    "UPDATE card_images SET missing_from_api = 1 WHERE game = 'pkm' AND card_id = ? AND missing_from_api = 0"
  )

  let cardsChanged = false
  db.transaction(() => {
    for (const plan of plans) {
      const { lang, report } = plan
      const seen = new Set<string>()
      for (const sp of plan.sets) {
        const { set } = sp
        const key = setImageKey(lang, set.id)
        const old = setByKey.get(lang, key) as
          | {
              set_name: string
              set_code: string
              tcg_date: string | null
              image_url: string | null
            }
          | undefined
        let setName: string
        let setCode: string
        const date = set.releaseDate || null
        if (old) {
          // Frozen: a written set keeps its name and code.
          setName = old.set_name
          setCode = old.set_code
          const image = old.image_url ?? (set.logo || null)
          if (old.tcg_date !== date || old.image_url !== image)
            updateSet.run(date, image, lang, key)
        } else {
          setCode = setAbbrev(set)
          setName = freeName(
            sp.groupName || set.name,
            [setCode, set.id],
            (n) => setByName.get(lang, n) !== undefined
          )
          if (setName !== (sp.groupName || set.name)) {
            report.problems.push(
              `${lang}/${set.id}: set name "${sp.groupName || set.name}" is taken; named "${setName}"`
            )
          }
          insertSet.run(lang, setName, setCode, date, set.logo || null, key)
        }

        for (const cp of sp.cards) {
          const { card } = cp
          const sourceId = `${lang}/${card.id}`
          seen.add(sourceId)
          const id = pokemonId(sourceId)
          const type = card.category ?? ''
          const desc = cardDesc(card)
          const row = cardRow.get(id) as { name: string; type: string; desc: string } | undefined
          if (!row) {
            insertCard.run(id, cp.name, type, desc, nowIso)
            cardsChanged = true
          } else if (row.name !== cp.name || row.type !== type || row.desc !== desc) {
            updateCard.run(cp.name, type, desc, nowIso, id)
            cardsChanged = true
          }
          upsertDetails.run({
            cardId: id,
            category: type,
            hp: typeof card.hp === 'number' ? card.hp : null,
            types: JSON.stringify(card.types ?? []),
            stage: card.stage ?? null,
            rarity: card.rarity ?? null,
            illustrator: card.illustrator ?? null,
            sourceId,
            imageUrl: cp.imageUrl,
            localName: cp.localName
          })
          const image = (detailsRow.get(id) as { image_url: string | null }).image_url
          if (image) report.images++
          upsertImage.run(pokemonId(`${sourceId}#img`), id)

          const existing = printingsOf.all(id) as ExistingPrinting[]
          // Frozen: a written card keeps its printings' set name and code.
          const printSetName = existing[0]?.set_name ?? setName
          const printSetCode = existing[0]?.set_code ?? printedNumber(setCode, set, card.localId)
          const byLabel = new Map(existing.map((p) => [p.set_rarity, p]))
          const produced = new Set<string>()
          for (const v of cp.versions) {
            produced.add(v.label)
            const p = byLabel.get(v.label)
            if (!p) {
              insertPrinting.run(
                id,
                printSetName,
                printSetCode,
                v.label,
                lang,
                v.productId,
                v.price
              )
              continue
            }
            let product = p.tcg_product_id
            let price = p.market_price
            if (product !== v.productId) {
              // A different product's old price says nothing about this one.
              product = v.productId
              price = v.price
            } else if (movedEnough(price, v.price)) {
              price = v.price
            }
            if (
              p.missing_from_api !== 0 ||
              product !== p.tcg_product_id ||
              price !== p.market_price
            ) {
              updatePrinting.run(0, product, price, p.id)
            }
          }
          // Sticky: a version no longer produced is kept, flagged missing.
          for (const p of existing) {
            if (!produced.has(p.set_rarity) && p.missing_from_api === 0) {
              updatePrinting.run(1, p.tcg_product_id, p.market_price, p.id)
            }
          }
        }
      }
      // A card TCGdex no longer lists keeps its rows, flagged missing.
      for (const k of knownCards.all(lang) as { card_id: number; source_id: string }[]) {
        if (seen.has(k.source_id)) continue
        flagPrintings.run(k.card_id)
        flagImages.run(k.card_id)
      }
    }
    if (cardsChanged) db.exec(`INSERT INTO cards_fts(cards_fts) VALUES('rebuild')`)
  })()
}

/** `name`, or the first of "name (alt)" not taken by another set of the language. */
function freeName(name: string, alts: string[], taken: (n: string) => boolean): string {
  if (!taken(name)) return name
  for (const a of alts) {
    const n = `${name} (${a})`
    if (!taken(n)) return n
  }
  throw new Error(`No free set name for "${name}"`)
}

/**
 * Refreshes the Pokémon catalog in `work`. Everything is fetched and matched first; any source
 * failure throws before a row is written. Then all languages are written in one transaction.
 */
export async function refreshPokemon(
  work: Database.Database,
  sources: PokemonSources,
  opts: RefreshPokemonOpts = {}
): Promise<PokemonReport[]> {
  const log = opts.log ?? ((): void => {})
  const langs = opts.langs ?? ['en', 'ja']
  const plans: LangPlan[] = []
  for (const lang of langs) plans.push(await planLanguage(lang, sources, log))
  writePlans(work, plans, (opts.now ?? (() => new Date()))().toISOString())
  return plans.map((p) => p.report)
}
