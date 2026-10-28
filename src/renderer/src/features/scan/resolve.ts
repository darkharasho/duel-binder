import type { Api } from '@shared/ipc'
import { LANGUAGES } from '@shared/languages'
import type { CardLanguage } from '@shared/scan/language'
import { pickRarity, pickRarityByCues, type RarityCues } from '@shared/scan/rarity'
import { setCodeCandidates } from '@shared/scan/setCode'
import {
  ART_FAR_DISTANCE,
  ART_MATCH_DEPTH,
  ART_MAX_DISTANCE,
  ART_MAX_DISTANCE_IN_SET,
  ART_MIN_MARGIN
} from '@shared/scan/thresholds'
import type { ScanDraft, ScanPrinting } from '@shared/scan/types'
import type { ArtMatch, RawSignals } from './engine'

export type { ScanDraft } from '@shared/scan/types'

/**
 * A frame's outcome. A `none` with `far` is something card-shaped whose art matched nothing
 * close, rather than nothing in view.
 */
export type ScanOutcome =
  { kind: 'none'; far?: true } | { kind: 'unsure' } | { kind: 'recognized'; item: ScanDraft }

export interface ResolveContext {
  setName: string | null
  /** The picked set's printings in its language; null when no set is picked. */
  setPrintings: ScanPrinting[] | null
  defaultRarity: string | null
  /**
   * The language the card's text reads as, for a card with printings in several languages and no
   * code read; null when it can't be told. Without it, such a card is taken in its first language.
   */
  cardLanguage?: (cardId: number) => Promise<CardLanguage | null>
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

/**
 * A card with no code read and no set to place it in: an assumed printing among all of its
 * printings, in the language its text reads as when it has printings in it, else in the first
 * language it has (English when it has one), of the rarity pickRarity chooses there, flagged for
 * the user to check unless the card was printed only once.
 */
async function anyPrinting(
  cardId: number,
  art: ArtMatch[],
  ctx: ResolveContext,
  via: 'art' | 'name'
): Promise<ScanDraft | null> {
  const options = await ctx.lookups.printingsForCards([cardId])
  const languages = LANGUAGES.filter((l) => options.some((o) => o.language === l.code))
  const read = languages.length > 1 ? await ctx.cardLanguage?.(cardId) : null
  // Chinese text is either form; its first one the card has.
  const language = (
    languages.find(
      (l) => read && (l.code === read || (read === 'zh' && l.code.startsWith('zh')))
    ) ?? languages[0]
  )?.code
  const ofLanguage = options.filter((o) => o.language === language)
  if (!ofLanguage.length) return null
  const { printing } = choose(ofLanguage, ctx.defaultRarity)
  const imageId = imageFor(art, printing.imageIds)
  if (imageId === undefined) return null
  return {
    cardId,
    name: printing.name,
    imageId,
    printingId: printing.printingId,
    setCode: printing.setCode,
    rarity: printing.rarity,
    options,
    flag: options.length === 1 ? null : 'pick-printing',
    via
  }
}

/**
 * The best artwork's card when it is close enough, and far enough ahead of the closest artwork
 * of any other card. Alternate artworks of the same card don't count against it. When no other
 * card shows up, the margin is unlimited if every candidate was ranked, else it runs to the last
 * match. An artwork missing from the catalog counts as another card.
 */
async function confidentArt(raw: RawSignals, ctx: ResolveContext): Promise<number | null> {
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
  return margin < ART_MIN_MARGIN ? null : cardId
}

/** The first name read, in order, that names a card. */
async function byName(raw: RawSignals, ctx: ResolveContext): Promise<ScanDraft | null> {
  for (const text of raw.nameTexts) {
    const match = await ctx.lookups.matchName(text)
    if (!match) continue
    return (
      inSet(match.cardId, raw.art, ctx, 'name') ?? anyPrinting(match.cardId, raw.art, ctx, 'name')
    )
  }
  return null
}

/**
 * What a frame shows: a card by its set code, else by its art, else by its name, or `unsure`
 * when a card is in view but none of those is trusted. A code read that names a different card
 * than confident art is a misread one way or the other, so it's unsure too. When art was matched
 * and its closest artwork is past ART_FAR_DISTANCE, what's in view isn't taken for a card at all
 * unless its code or name reads: `none`.
 */
export async function resolveSignals(raw: RawSignals, ctx: ResolveContext): Promise<ScanOutcome> {
  if (!raw.found) return { kind: 'none' }
  const artCard = await confidentArt(raw, ctx)
  const code = await byCode(raw, ctx)
  if (code && artCard !== null && code.cardId !== artCard) return { kind: 'unsure' }
  const item =
    code ??
    (artCard !== null
      ? ctx.setPrintings
        ? inSet(artCard, raw.art, ctx, 'art')
        : await anyPrinting(artCard, raw.art, ctx, 'art')
      : null) ??
    (await byName(raw, ctx))
  if (item) return { kind: 'recognized', item }
  const [top] = raw.art
  return top && top.distance > ART_FAR_DISTANCE ? { kind: 'none', far: true } : { kind: 'unsure' }
}

/**
 * The draft with the rarity its look picks, under Auto (no default rarity), when the look
 * settles which of its code's rarities it is: no longer flagged Check rarity, and on the
 * printing of that rarity showing the draft's artwork when there is one. Unchanged when the
 * rarity was already certain, the user said what the stack is, or the look doesn't settle it.
 */
export function withRarityByLook(
  item: ScanDraft,
  cues: RarityCues | null,
  defaultRarity: string | null
): ScanDraft {
  const current = item.options.find((p) => p.printingId === item.printingId)
  if (!current || defaultRarity !== null || !cues || (!cues.nameInk && !cues.surface)) return item
  const sameCode = item.options.filter(
    (p) => p.setCode === current.setCode && p.language === current.language
  )
  const available = sameCode.map((p) => p.rarity)
  if (pickRarity(available, null).certain) return item
  const { rarity, certain } = pickRarityByCues(available, cues, current.frameType)
  const ofRarity = sameCode.filter((p) => p.rarity === rarity)
  const printing = ofRarity.find((p) => p.imageIds.includes(item.imageId)) ?? ofRarity[0]
  if (!certain || !printing) return item
  return {
    ...item,
    printingId: printing.printingId,
    rarity,
    flag: item.flag === 'check-rarity' ? null : item.flag
  }
}
