import { LANGUAGES, type Language } from '@shared/languages'
import { frameNumber, readHints } from '@shared/scan/onePieceNumber'
import {
  ART_FAR_DISTANCE,
  ART_MATCH_DEPTH,
  ART_MAX_DISTANCE,
  ART_MAX_DISTANCE_IN_SET,
  OP_ART_MIN_MARGIN,
  OP_SAME_ART
} from '@shared/scan/thresholds'
import type { ScanDraft, ScanPrinting } from '@shared/scan/types'
import type { RawSignals } from './engine'
import type { ResolveContext, ScanOutcome } from './resolve'

/**
 * One Piece cards (game 'op'). A card is its printed number ("OP05-119"): every printing of it
 * shares it, English and Japanese, base, parallels and the reprints a premium booster or deck
 * borrows. Each printing has its own art (scan.ts gives it only that image), so art tells a
 * parallel from its base, but not an English card from its Japanese twin, whose art above the
 * SAMPLE stamp hashes the same, nor a reprint from the card it reprints.
 *
 * So a frame is read as: the number, when one reads on its code bands; else the number of the
 * closest art, when it is OP_ART_MIN_MARGIN ahead of every other number's. A number read one digit
 * off confident art's, in the same set, or a promo "P-" number with its digits (setLost), is taken
 * as misread (the art's number stands); one that names another card than confident art otherwise
 * is a misread one way or the other: unsure. Then the
 * language: a picked set's, else the user's language filter, else the language the text reads
 * as, else English. Then, among that number's printings in that language (in the picked set when
 * it has some), the one whose art is closest; when another's is within OP_SAME_ART of it, or
 * none was matched, the row asks for its printing to be checked.
 */
export async function resolveOnePieceSignals(
  raw: RawSignals,
  ctx: ResolveContext
): Promise<ScanOutcome> {
  if (!raw.found) return { kind: 'none' }
  const read = frameNumber(raw.codeTexts)
  const artNumber = await confidentNumber(raw, ctx)
  // A read one digit off confident art in the same set is the read gone wrong: the number's
  // digits are small and soft, and art that far ahead of every other number isn't.
  const misread =
    read !== null &&
    artNumber !== null &&
    (oneDigitApart(read, artNumber) || setLost(read, artNumber))
  const byRead = read && !misread ? await ctx.lookups.printingsByCode(read) : []
  if (byRead.length && artNumber !== null && artNumber !== byRead[0].setCode.toUpperCase())
    return { kind: 'unsure' }
  const options = byRead.length
    ? byRead
    : artNumber !== null
      ? await ctx.lookups.printingsByCode(artNumber)
      : []
  const item = options.length
    ? await choose(options, raw, ctx, byRead.length ? 'code' : 'art')
    : null
  if (item) return { kind: 'recognized', item }
  const [top] = raw.art
  return top && top.distance > ART_FAR_DISTANCE ? { kind: 'none', far: true } : { kind: 'unsure' }
}

/**
 * "P-073" read off OP08-073: the set's digits and its O lost, leaving what reads as a promo
 * number with the card's digits.
 */
export function setLost(read: string, art: string): boolean {
  const [setR, numR] = read.toUpperCase().split('-')
  const [setA, numA] = art.toUpperCase().split('-')
  return setR === 'P' && setA.startsWith('OP') && numR === numA
}

/** "OP13-116" and "OP13-115": one set, card numbers one digit apart. */
export function oneDigitApart(a: string, b: string): boolean {
  const [setA, numA] = a.toUpperCase().split('-')
  const [setB, numB] = b.toUpperCase().split('-')
  if (setA !== setB || !numA || !numB || numA.length !== numB.length) return false
  let off = 0
  for (let i = 0; i < numA.length; i++) if (numA[i] !== numB[i]) off++
  return off === 1
}

/**
 * The number of the closest artwork, when it is close enough and OP_ART_MIN_MARGIN ahead of the
 * closest artwork of any other number, or ahead at all with the bands' read hinting at it
 * (readHints) and not at the runner-up's. An artwork missing from the catalog counts as another
 * number. With no other number in sight, the margin is unlimited if every candidate was ranked,
 * else it runs to the last match.
 */
async function confidentNumber(raw: RawSignals, ctx: ResolveContext): Promise<string | null> {
  const [top] = raw.art
  const maxDistance = ctx.setPrintings ? ART_MAX_DISTANCE_IN_SET : ART_MAX_DISTANCE
  if (!top || top.distance > maxDistance) return null
  const numberOf = await numbersOfImages(
    raw.art.map((a) => a.imageId),
    ctx
  )
  const number = numberOf.get(top.imageId)
  if (number === undefined) return null
  const rival = raw.art.find((a) => numberOf.get(a.imageId) !== number)
  const last = raw.art[raw.art.length - 1]
  const margin = rival
    ? rival.distance - top.distance
    : raw.art.length < ART_MATCH_DEPTH
      ? Infinity
      : last.distance - top.distance
  if (margin >= OP_ART_MIN_MARGIN) return number
  // Short of the margin, a band read too broken to give a number can still settle it: one that
  // points at the closest art's number and not at the runner-up's ("P-073" for OP08-073).
  const rivalNumber = rival && numberOf.get(rival.imageId)
  const hinted =
    margin > 0 &&
    readHints(raw.codeTexts, number) &&
    !(rivalNumber && readHints(raw.codeTexts, rivalNumber))
  return hinted ? number : null
}

/** Each artwork's printed number, for the artworks a printing shows. */
async function numbersOfImages(
  imageIds: number[],
  ctx: ResolveContext
): Promise<Map<number, string>> {
  const cards = await ctx.lookups.cardsForImages(imageIds)
  const printings = cards.length
    ? await ctx.lookups.printingsForCards([...new Set(cards.map((c) => c.cardId))])
    : []
  const out = new Map<number, string>()
  for (const p of printings) {
    for (const id of p.imageIds) if (!out.has(id)) out.set(id, p.setCode.toUpperCase())
  }
  return out
}

/** The language the card is taken in, among the languages `options` come in. */
async function languageOf(
  options: ScanPrinting[],
  ctx: ResolveContext,
  closest: ScanPrinting | undefined
): Promise<Language | undefined> {
  const languages = LANGUAGES.filter((l) => options.some((o) => o.language === l.code)).map(
    (l) => l.code
  )
  if (languages.length < 2) return languages[0]
  const inSet = (ctx.setPrintings ?? []).find((s) =>
    options.some((o) => o.printingId === s.printingId)
  )
  if (inSet) return inSet.language
  if (ctx.filterLanguage && languages.includes(ctx.filterLanguage)) return ctx.filterLanguage
  const read = await ctx.cardLanguage?.((closest ?? options[0]).cardId)
  return languages.find((l) => l === read) ?? languages[0]
}

/** The number's printing the frame shows, among `options` (all of the number's). */
async function choose(
  options: ScanPrinting[],
  raw: RawSignals,
  ctx: ResolveContext,
  via: 'code' | 'art'
): Promise<ScanDraft | null> {
  const distanceOf = new Map(raw.art.map((a) => [a.imageId, a.distance]))
  const artDistance = (p: ScanPrinting): number =>
    Math.min(Infinity, ...p.imageIds.map((id) => distanceOf.get(id) ?? Infinity))
  const ranked = [...options].sort((a, b) => artDistance(a) - artDistance(b))
  const language = await languageOf(options, ctx, ranked[0])
  const ofLanguage = ranked.filter((p) => p.language === language)
  const set = new Set((ctx.setPrintings ?? []).map((p) => p.printingId))
  const inSet = ofLanguage.filter((p) => set.has(p.printingId))
  const among = inSet.length ? inSet : ofLanguage
  const [best, next] = among
  if (!best) return null
  const d = artDistance(best)
  const certain =
    among.length === 1 || (d !== Infinity && (!next || artDistance(next) - d > OP_SAME_ART))
  // With no art to go on, the plain printing, not a parallel's.
  const printing = d === Infinity ? (among.find((p) => !p.rarity.includes('(')) ?? best) : best
  const imageId =
    printing.imageIds.find((id) => distanceOf.has(id)) ??
    printing.imageIds[0] ??
    raw.art[0]?.imageId
  if (imageId === undefined) return null
  const otherSet = ctx.setPrintings !== null && !inSet.length
  return {
    game: 'op',
    cardId: printing.cardId,
    name: printing.name,
    imageId,
    printingId: printing.printingId,
    setCode: printing.setCode,
    rarity: printing.rarity,
    options,
    flag: otherSet ? 'other-set' : certain ? null : 'pick-printing',
    via
  }
}
