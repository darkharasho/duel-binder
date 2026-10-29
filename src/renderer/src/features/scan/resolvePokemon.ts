import { collectorNumberCandidates } from '@shared/scan/collectorNumber'
import { normalizeName } from '@shared/scan/names'
import {
  ART_FAR_DISTANCE,
  ART_MATCH_DEPTH,
  ART_MAX_DISTANCE,
  ART_MIN_MARGIN
} from '@shared/scan/thresholds'
import type { ScanDraft, ScanPrinting } from '@shared/scan/types'
import type { RawSignals } from './engine'
import { pokemonVersion } from './vision/pokemonVersion'
import type { ResolveContext, ScanOutcome } from './resolve'

type Read = 'en' | 'ja' | 'other' | null

/**
 * The cards whose art is close enough and within ART_MIN_MARGIN of the best, closest first. A
 * Pokémon card's English and Japanese twins share art, as do reprints, so they all come in and
 * the language or number decides between them rather than the margin. Null when the group
 * can't be trusted to be whole: an artwork in it is missing from the catalog, or every match
 * ranked falls inside the margin, so more may lie past the last.
 */
async function artGroup(raw: RawSignals, ctx: ResolveContext): Promise<number[] | null> {
  const [top] = raw.art
  if (!top || top.distance > ART_MAX_DISTANCE) return []
  const near = raw.art.filter(
    (a) => a.distance <= ART_MAX_DISTANCE && a.distance <= top.distance + ART_MIN_MARGIN
  )
  if (near.length === raw.art.length && raw.art.length >= ART_MATCH_DEPTH) return null
  const cardOf = new Map(
    (await ctx.lookups.cardsForImages(near.map((a) => a.imageId))).map((c) => [c.imageId, c.cardId])
  )
  const cards: number[] = []
  for (const a of near) {
    const cardId = cardOf.get(a.imageId)
    if (cardId === undefined) return null
    if (!cards.includes(cardId)) cards.push(cardId)
  }
  return cards
}

/** The printings of the first collector number, over every code band read, that names any. */
async function byNumber(raw: RawSignals, ctx: ResolveContext): Promise<ScanPrinting[]> {
  const tried = new Set<string>()
  for (const text of raw.codeTexts) {
    for (const n of collectorNumberCandidates(text)) {
      const key = `${n.setAbbrev}|${n.number}|${n.total}`
      if (tried.has(key)) continue
      tried.add(key)
      const found = await ctx.lookups.printingsByNumber(n)
      if (found.length) return found
    }
  }
  return []
}

/** The card the first name read, in order, names; null when none does. */
async function nameRead(
  raw: RawSignals,
  ctx: ResolveContext
): Promise<{ cardId: number; name: string } | null> {
  for (const text of raw.nameTexts) {
    const match = await ctx.lookups.matchName(text)
    if (match) return match
  }
  return null
}

/**
 * Whether a name read agrees with the card: it is the card, or a card of the same name (a
 * Pokémon has many cards of one name). Names with no Latin letters are compared as they are,
 * as normalizeName leaves nothing of them.
 */
const sameName = (a: string, b: string): boolean =>
  normalizeName(a) ? normalizeName(a) === normalizeName(b) : a === b

const unique = (ids: number[]): number[] => [...new Set(ids)]

/**
 * The card's draft, its versions to pick from: sure when it has one, else flagged pick-printing
 * on the cheapest, which is only a placeholder (the overlay shows the range across them).
 */
async function draft(
  cardId: number,
  raw: RawSignals,
  ctx: ResolveContext,
  via: 'code' | 'art'
): Promise<ScanDraft | null> {
  const options = await ctx.lookups.printingsForCards([cardId])
  if (!options.length) return null
  const printing = options.reduce((a, b) => ((b.price ?? Infinity) < (a.price ?? Infinity) ? b : a))
  const [top] = raw.art
  const imageId =
    top && printing.imageIds.includes(top.imageId) ? top.imageId : printing.imageIds[0]
  if (imageId === undefined) return null
  // The foil, when it names one of the versions for sure, is the version; else a range.
  const label =
    options.length > 1
      ? pokemonVersion(
          raw.version ?? null,
          options.map((o) => o.rarity)
        )
      : null
  const named = label === null ? null : options.find((o) => o.rarity === label)
  const chosen = named ?? printing
  return {
    cardId,
    name: printing.name,
    imageId,
    printingId: chosen.printingId,
    setCode: chosen.setCode,
    rarity: chosen.rarity,
    options,
    flag: options.length === 1 || named ? null : 'pick-printing',
    via,
    game: 'pkm'
  }
}

/**
 * What a frame shows of a Pokémon card, named only when art, number and language agree on one
 * card. A Chinese, European (or any other uncatalogued) card shares its art and often its number
 * with a Japanese or English twin, so a card is named only in a language read as English or
 * Japanese; anything else, unread included, is `unsure`.
 *
 * - With a collector number read: the art's cards that carry it, or with no art close, the
 *   number's cards a name read agrees with; one of them in the read language is named,
 *   `via: 'code'`.
 * - Without: the art's cards; one of them in the read language is named.
 * - Nothing at all, and the closest artwork past ART_FAR_DISTANCE: `none`, far.
 *
 * The language is read only once there's a card to name, and at most once; a read that fails
 * counts as unread.
 */
export async function resolvePokemonSignals(
  raw: RawSignals,
  ctx: ResolveContext
): Promise<ScanOutcome> {
  if (!raw.found) return { kind: 'none' }
  const unsure: ScanOutcome = { kind: 'unsure' }
  let read: Promise<Read> | null = null
  const language = (): Promise<Read> =>
    (read ??= Promise.resolve()
      .then(() => ctx.readLanguage?.() ?? null)
      .catch(() => null))

  const group = await artGroup(raw, ctx)
  if (group === null) return unsure
  const numbered = await byNumber(raw, ctx)
  const named = async (cardId: number, via: 'code' | 'art'): Promise<ScanOutcome> => {
    const item = await draft(cardId, raw, ctx, via)
    return item ? { kind: 'recognized', item } : unsure
  }

  if (numbered.length) {
    const name = group.length ? null : await nameRead(raw, ctx)
    const cards = numbered.filter((p) =>
      group.length
        ? group.includes(p.cardId)
        : !!name && (name.cardId === p.cardId || sameName(name.name, p.name))
    )
    if (!cards.length) return unsure
    const lang = await language()
    if (lang === null || lang === 'other') return unsure
    const ids = unique(cards.filter((p) => p.language === lang).map((p) => p.cardId))
    return ids.length === 1 ? named(ids[0], 'code') : unsure
  }

  if (!group.length) {
    const [top] = raw.art
    return top && top.distance > ART_FAR_DISTANCE ? { kind: 'none', far: true } : unsure
  }
  const lang = await language()
  if (lang === null || lang === 'other') return unsure
  const printings = await ctx.lookups.printingsForCards(group)
  const ids = unique(printings.filter((p) => p.language === lang).map((p) => p.cardId))
  return ids.length === 1 ? named(ids[0], 'art') : unsure
}
