import type { Api } from '@shared/ipc'
import { pickRarity } from '@shared/scan/rarity'
import { setCodeCandidates } from '@shared/scan/setCode'
import {
  ART_MATCH_DEPTH,
  ART_MAX_DISTANCE,
  ART_MAX_DISTANCE_IN_SET,
  ART_MIN_MARGIN
} from '@shared/scan/thresholds'
import type { ScanPrinting } from '@shared/scan/types'
import type { ArtMatch, RawSignals } from './engine'

/** A card the scanner recognized, ready to go in the session list. */
export interface ScanDraft {
  cardId: number
  name: string
  imageId: number
  /** Null when the printing is for the user to pick. */
  printingId: number | null
  setCode: string | null
  rarity: string | null
  /** The printings the user may switch to. */
  options: ScanPrinting[]
  flag: 'check-rarity' | 'pick-printing' | 'other-set' | null
  via: 'code' | 'art' | 'name'
}

export type ScanOutcome =
  { kind: 'none' } | { kind: 'unsure' } | { kind: 'recognized'; item: ScanDraft }

export interface ResolveContext {
  setName: string | null
  /** The picked set's printings in its language; null when no set is picked. */
  setPrintings: ScanPrinting[] | null
  defaultRarity: string | null
  lookups: Pick<
    Api['scan'],
    'printingsByCode' | 'printingsForCards' | 'matchName' | 'cardsForImages'
  >
}

/** The art's best match when it is one of the card's artworks, else the card's first. */
const imageFor = (art: ArtMatch[], imageIds: number[]): number | undefined =>
  art[0] && imageIds.includes(art[0].imageId) ? art[0].imageId : imageIds[0]

/** The printing among same-code printings whose rarity pickRarity chooses. */
function choose(
  printings: ScanPrinting[],
  defaultRarity: string | null
): { printing: ScanPrinting; certain: boolean } {
  const { rarity, certain } = pickRarity(
    printings.map((p) => p.rarity),
    defaultRarity
  )
  return { printing: printings.find((p) => p.rarity === rarity) ?? printings[0], certain }
}

/** The first code candidate, over every code band read, that names a printing. */
async function byCode(raw: RawSignals, ctx: ResolveContext): Promise<ScanDraft | null> {
  const tried = new Set<string>()
  for (const text of raw.codeTexts) {
    for (const code of setCodeCandidates(text)) {
      if (tried.has(code)) continue
      tried.add(code)
      const found = await ctx.lookups.printingsByCode(code)
      if (!found.length) continue
      const { printing, certain } = choose(found, ctx.defaultRarity)
      const imageId = imageFor(raw.art, printing.imageIds)
      if (imageId === undefined) continue
      const otherSet =
        ctx.setPrintings !== null &&
        !ctx.setPrintings.some((p) => p.printingId === printing.printingId)
      return {
        cardId: printing.cardId,
        name: printing.name,
        imageId,
        printingId: printing.printingId,
        setCode: printing.setCode,
        rarity: printing.rarity,
        options: found,
        flag: otherSet ? 'other-set' : certain ? null : 'check-rarity',
        via: 'code'
      }
    }
  }
  return null
}

/**
 * A card found by art or name within the picked set: its first code in the set, with the
 * rarity pickRarity chooses among that code's printings, and all its set printings to pick from.
 */
function inSet(
  cardId: number,
  art: ArtMatch[],
  ctx: ResolveContext,
  via: 'art' | 'name'
): ScanDraft | null {
  const own = (ctx.setPrintings ?? []).filter((p) => p.cardId === cardId)
  if (!own.length) return null
  const { printing, certain } = choose(
    own.filter((p) => p.setCode === own[0].setCode),
    ctx.defaultRarity
  )
  const imageId = imageFor(art, printing.imageIds)
  if (imageId === undefined) return null
  return {
    cardId,
    name: printing.name,
    imageId,
    printingId: printing.printingId,
    setCode: printing.setCode,
    rarity: printing.rarity,
    options: own,
    flag: certain ? null : 'check-rarity',
    via
  }
}

/** A card whose printing the user picks from all of its printings. */
async function anyPrinting(
  cardId: number,
  art: ArtMatch[],
  ctx: ResolveContext,
  via: 'art' | 'name'
): Promise<ScanDraft | null> {
  const options = await ctx.lookups.printingsForCards([cardId])
  const imageId = options[0] && imageFor(art, options[0].imageIds)
  if (imageId === undefined) return null
  return {
    cardId,
    name: options[0].name,
    imageId,
    printingId: null,
    setCode: null,
    rarity: null,
    options,
    flag: 'pick-printing',
    via
  }
}

/**
 * The best artwork's card when it is close enough, and far enough ahead of the closest artwork
 * of any other card. Alternate artworks of the same card don't count against it. When no other
 * card shows up, the margin is unlimited if every candidate was ranked, else it runs to the last
 * match. An artwork missing from the catalog counts as another card.
 */
async function byArt(raw: RawSignals, ctx: ResolveContext): Promise<ScanDraft | null> {
  const [top] = raw.art
  const maxDistance = ctx.setPrintings ? ART_MAX_DISTANCE_IN_SET : ART_MAX_DISTANCE
  if (!top || top.distance > maxDistance) return null
  const cardOf = new Map(
    (await ctx.lookups.cardsForImages(raw.art.map((a) => a.imageId))).map((c) => [
      c.imageId,
      c.cardId
    ])
  )
  const cardId = cardOf.get(top.imageId)
  if (cardId === undefined) return null
  const rival = raw.art.find((a) => cardOf.get(a.imageId) !== cardId)
  const last = raw.art[raw.art.length - 1]
  const margin = rival
    ? rival.distance - top.distance
    : raw.art.length < ART_MATCH_DEPTH
      ? Infinity
      : last.distance - top.distance
  if (margin < ART_MIN_MARGIN) return null
  return ctx.setPrintings
    ? inSet(cardId, raw.art, ctx, 'art')
    : anyPrinting(cardId, raw.art, ctx, 'art')
}

async function byName(raw: RawSignals, ctx: ResolveContext): Promise<ScanDraft | null> {
  if (!raw.nameText) return null
  const match = await ctx.lookups.matchName(raw.nameText)
  if (!match) return null
  return (
    inSet(match.cardId, raw.art, ctx, 'name') ?? anyPrinting(match.cardId, raw.art, ctx, 'name')
  )
}

/**
 * What a frame shows: a card by its set code, else by its art, else by its name, or `unsure`
 * when a card is in view but none of those is trusted.
 */
export async function resolveSignals(raw: RawSignals, ctx: ResolveContext): Promise<ScanOutcome> {
  if (!raw.found) return { kind: 'none' }
  const item = (await byCode(raw, ctx)) ?? (await byArt(raw, ctx)) ?? (await byName(raw, ctx))
  return item ? { kind: 'recognized', item } : { kind: 'unsure' }
}
