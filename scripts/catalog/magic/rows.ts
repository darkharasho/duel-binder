import { mtgCardId, mtgImageId } from '../../../src/shared/games/ids'
import { MTG_CARD_TYPES, MTG_RARITIES } from '../../../src/shared/games/magic'
import type { ScryCard, ScryFace, ScrySet } from './types'

export interface MtgCardRow {
  id: number
  oracleId: string
  name: string
  type: string
  desc: string
  layout: string
  typeLine: string
  types: string[]
  manaCost: string | null
  manaValue: number | null
  colors: string[]
  colorIdentity: string[]
  oracleText: string | null
  power: string | null
  toughness: string | null
  loyalty: string | null
  defense: string | null
  keywords: string[]
  faces: string | null
}

export interface MtgImageRow {
  imageId: number
  cardId: number
  scryfallId: string
  illustrationId: string | null
  artist: string | null
  frame: string
  borderColor: string
  fullArt: boolean
  promoTypes: string[]
}

export type MtgFinish = 'nonfoil' | 'foil' | 'etched'

export interface MtgPrintingRow {
  cardId: number
  scryfallId: string
  finish: MtgFinish
  setCode: string
  code: string
  rarity: string
  price: number | null
}

export interface MtgSetRow {
  code: string
  name: string
  series: string
  releasedAt: string | null
}

export interface MagicRows {
  cards: Map<number, MtgCardRow>
  images: MtgImageRow[]
  printings: MtgPrintingRow[]
  sets: Map<string, MtgSetRow>
  notes: string[]
}

const WUBRG = ['W', 'U', 'B', 'R', 'G']
const FINISHES: { finish: MtgFinish; price: 'usd' | 'usd_foil' | 'usd_etched'; suffix: string }[] =
  [
    { finish: 'nonfoil', price: 'usd', suffix: '' },
    { finish: 'foil', price: 'usd_foil', suffix: ' (Foil)' },
    { finish: 'etched', price: 'usd_etched', suffix: ' (Etched Foil)' }
  ]

const rarityLabel = (r: string): string | undefined =>
  MTG_RARITIES.find((x) => x.toLowerCase() === r.toLowerCase())

function priceOf(s: string | null | undefined): number | null {
  if (s === null || s === undefined) return null
  const n = Number(s)
  return Number.isFinite(n) && n >= 0 ? n : null
}

const orNull = (s: string | undefined): string | null => (s === undefined || s === '' ? null : s)

function cardRow(o: ScryCard, oracleId: string): MtgCardRow {
  const faces: ScryFace[] = o.card_faces ?? []
  const face0 = faces[0]
  const typeLines = faces.length > 0 ? faces.map((f) => f.type_line ?? '') : [o.type_line ?? '']
  const words = new Set(
    typeLines.flatMap((t) => (t.split('—')[0] ?? '').split(/\s+/).filter((w) => w !== ''))
  )
  const types = MTG_CARD_TYPES.filter((t) => words.has(t)) as string[]
  const texts = faces.map((f) => f.oracle_text ?? '')
  const oracleText = o.oracle_text ?? (faces.length > 0 ? texts.join('\n//\n') : undefined)
  const colors = o.colors ?? WUBRG.filter((c) => faces.some((f) => (f.colors ?? []).includes(c)))
  return {
    id: mtgCardId('en', oracleId),
    oracleId,
    name: o.name,
    type: types[0] ?? 'Other',
    desc: oracleText ?? '',
    layout: o.layout,
    typeLine: o.type_line ?? typeLines.filter((t) => t !== '').join(' // '),
    types,
    manaCost: orNull(o.mana_cost ?? face0?.mana_cost),
    manaValue: typeof o.cmc === 'number' ? o.cmc : null,
    colors,
    colorIdentity: o.color_identity ?? [],
    oracleText: oracleText ?? null,
    power: o.power ?? face0?.power ?? null,
    toughness: o.toughness ?? face0?.toughness ?? null,
    loyalty: o.loyalty ?? face0?.loyalty ?? null,
    defense: o.defense ?? face0?.defense ?? null,
    keywords: o.keywords ?? [],
    faces:
      faces.length > 0
        ? JSON.stringify(
            faces.map((f) => ({
              name: f.name,
              mana_cost: f.mana_cost ?? null,
              type_line: f.type_line ?? null,
              oracle_text: f.oracle_text ?? null,
              power: f.power ?? null,
              toughness: f.toughness ?? null,
              loyalty: f.loyalty ?? null,
              defense: f.defense ?? null
            }))
          )
        : null
  }
}

/**
 * An object with no top-level oracle id (a reversible card, a double-faced token) as one
 * single-faced card made of face 0 alone, never a doubled "X // X" card.
 */
function faceZeroView(o: ScryCard): ScryCard {
  const f = o.card_faces?.[0]
  if (!f) return o
  return {
    ...o,
    name: f.name,
    layout: 'normal',
    mana_cost: f.mana_cost,
    cmc: f.cmc ?? o.cmc,
    type_line: f.type_line,
    oracle_text: f.oracle_text,
    colors: f.colors ?? o.colors,
    power: f.power,
    toughness: f.toughness,
    loyalty: f.loyalty,
    defense: f.defense,
    card_faces: undefined
  }
}

/** Maps kept Scryfall objects (see `isKept`) to the Magic catalog rows. */
export function mtgRows(objects: Iterable<ScryCard>, sets: ScrySet[]): MagicRows {
  const out: MagicRows = {
    cards: new Map(),
    images: [],
    printings: [],
    sets: new Map(),
    notes: []
  }
  const byCode = new Map(sets.map((s) => [s.code.toLowerCase(), s]))
  const seen = new Set<string>()
  const faceOnly = new Set<number>()

  for (const o of objects) {
    const rarity = rarityLabel(o.rarity)
    if (!rarity) {
      out.notes.push(`unknown Magic rarity ${o.rarity}: ${o.id}`)
      continue
    }
    const oracleId = o.oracle_id ?? o.card_faces?.[0]?.oracle_id
    if (!oracleId) {
      out.notes.push(`Magic card without an oracle id: ${o.id}`)
      continue
    }
    const setCode = o.set.toUpperCase()
    const code = `${setCode} ${o.collector_number}`
    const cardId = mtgCardId('en', oracleId)
    const printings: MtgPrintingRow[] = []
    for (const f of FINISHES) {
      if (!o.finishes.includes(f.finish)) continue
      const key = `${code}\u0000${f.finish}`
      if (seen.has(key)) {
        out.notes.push(`duplicate Magic printing ${code} ${f.finish}: ${o.id}`)
        continue
      }
      seen.add(key)
      printings.push({
        cardId,
        scryfallId: o.id,
        finish: f.finish,
        setCode,
        code,
        rarity: rarity + f.suffix,
        price: priceOf(o.prices?.[f.price])
      })
    }
    if (printings.length === 0) continue

    // A row from an object with its own oracle id wins over one from the face-0 fallback
    // (reversible cards, double-faced tokens), whatever order the file lists them in.
    const fromFace = o.oracle_id === undefined
    if (!out.cards.has(cardId)) {
      out.cards.set(cardId, cardRow(fromFace ? faceZeroView(o) : o, oracleId))
      if (fromFace) faceOnly.add(cardId)
    } else if (!fromFace && faceOnly.has(cardId)) {
      out.cards.set(cardId, cardRow(o, oracleId))
      faceOnly.delete(cardId)
    }
    const face0 = o.card_faces?.[0]
    out.images.push({
      imageId: mtgImageId(o.id),
      cardId,
      scryfallId: o.id,
      illustrationId: o.illustration_id ?? face0?.illustration_id ?? null,
      artist: o.artist ?? face0?.artist ?? null,
      frame: o.frame,
      borderColor: o.border_color,
      fullArt: o.full_art === true,
      promoTypes: o.promo_types ?? []
    })
    out.printings.push(...printings)

    if (!out.sets.has(setCode)) {
      const s = byCode.get(o.set.toLowerCase())
      const name = s?.name ?? o.set_name
      const parent = s?.parent_set_code ? byCode.get(s.parent_set_code.toLowerCase()) : undefined
      out.sets.set(setCode, {
        code: setCode,
        name,
        series: parent?.name ?? name,
        releasedAt: s?.released_at ?? null
      })
    }
  }
  return out
}
