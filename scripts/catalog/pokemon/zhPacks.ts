/**
 * Simplified Chinese pack pictures: the official product list on pokemon.cn first (its newest
 * products), else PokiPair's set picture. Copied once into R2 by the zh art step
 * (pokipairMirror.ts) as `hand/zh-hans-pack-<set>/pack.png`, see-through, and written to
 * `pokemon_set_art` by the Pokémon stage with an `hp-` key.
 */
import { createHash } from 'node:crypto'
import type Database from 'better-sqlite3'
import { PNG } from 'pngjs'
import { HAND_ART_PREFIX } from '../../../src/shared/imageSources'
import { decodeImage } from '../references'
import { shrink } from '../thumbs'

export const OFFICIAL_PRODUCTS = 'https://www.pokemon.cn/products_category/products/'
/** The zsjy947 list's set index, which has each set's Chinese name (chinese.ts pins the same commit). */
export const ZH_SET_INDEX =
  'https://raw.githubusercontent.com/zsjy947/PTCG-card-data/7f03f38f4538f01d8ee03121aa91aad3b0ae1149/data/sets_index.json'

/** A pack copy is no wider than this: a set tile shows it small. */
const PACK_WIDTH = 480

export interface OfficialProduct {
  name: string
  /** Signed with an `auth_key` that expires: fetched the night it is read. */
  image: string
}

const unescape = (s: string): string =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")

/** The products on pokemon.cn's product list. */
export function parseOfficialProducts(html: string): OfficialProduct[] {
  const out: OfficialProduct[] = []
  for (const li of html.match(/<li class="List_item">[\s\S]*?<div class="Title">/g) ?? []) {
    const img = /<img[^>]*\ssrc="([^"]+)"[^>]*\salt="([^"]*)"/.exec(li)
    if (img) out.push({ name: unescape(img[2]).trim(), image: unescape(img[1]) })
  }
  return out
}

/** A name with its product words dropped: "宝可梦集换式卡牌游戏 补充包 30周年庆典" is "30周年庆典". */
const bare = (name: string): string =>
  name
    .normalize('NFKC')
    .replace(/pok[eé]mon/gi, '')
    .replace(/宝可梦集换式卡牌游戏|补充包|强化包|扩充包/g, '')
    .replace(/[\s·・\-–—_:：.,，、!！()（）]/g, '')
    .toLowerCase()

/** The set a product is the pack of, by its Chinese name; null unless exactly one set has it. */
export function officialSetOf(name: string, zhNames: ReadonlyMap<string, string>): string | null {
  const want = bare(name)
  if (!want) return null
  const hits = [...zhNames].filter(([, n]) => bare(n) === want)
  return hits.length === 1 ? hits[0][0] : null
}

/** A pack's key in `pokemon_set_art`, from where it was copied (its expiring query left out). */
export const packKey = (source: string): string =>
  `hp-${createHash('sha1').update(source.split('?')[0]).digest('hex').slice(0, 20)}`

/** Where a set's pack copy is served from. */
export const packUrl = (setId: string): string =>
  `${HAND_ART_PREFIX}zh-hans-pack-${setId.toLowerCase().replace(/[^a-z0-9]+/g, '-')}/pack.png`

/** The hand-art id packUrl serves from. */
export const packHandId = (setId: string): string =>
  packUrl(setId).slice(HAND_ART_PREFIX.length).split('/')[0]

/** A see-through PNG of a pack picture, no wider than PACK_WIDTH; null when it won't decode. */
export function packCopy(bytes: Uint8Array): Uint8Array | null {
  let img
  try {
    img = decodeImage(bytes)
  } catch {
    return null
  }
  if (!img || img.width <= 0 || img.height <= 0) return null
  const small = shrink(img, PACK_WIDTH)
  const png = new PNG({ width: small.width, height: small.height })
  png.data = Buffer.from(small.data)
  return new Uint8Array(PNG.sync.write(png))
}

/**
 * The zh-hans pack rows from what the zh art step copied (set id to the picture it copied),
 * replacing last night's; a set id with no printings is left out.
 */
export function writeZhPackArt(
  db: Database.Database,
  packs: Readonly<Record<string, string>>
): void {
  const nameOf = db.prepare(
    `SELECT p.set_name AS name FROM pokemon_cards pc JOIN card_printings p ON p.card_id = pc.card_id
     WHERE pc.source_id >= ? AND pc.source_id < ? AND p.language = 'zh-hans' LIMIT 1`
  )
  const insert = db.prepare(
    `INSERT INTO pokemon_set_art (language, set_name, kind, sort_order, image_url, image_key)
     VALUES ('zh-hans', ?, 'pack', 0, ?, ?)`
  )
  db.transaction(() => {
    db.exec("DELETE FROM pokemon_set_art WHERE language = 'zh-hans' AND kind = 'pack'")
    for (const [setId, source] of Object.entries(packs)) {
      // Source ids "zh-hans/<set>-<number>": the range of the set's prefix.
      const row = nameOf.get(`zh-hans/${setId}-`, `zh-hans/${setId}.`) as
        { name: string } | undefined
      if (row) insert.run(row.name, packUrl(setId), packKey(source))
    }
  })()
}
