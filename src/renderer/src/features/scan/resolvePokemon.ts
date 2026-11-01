import { collectorNumberCandidates } from '@shared/scan/collectorNumber'
import { normalizeName } from '@shared/scan/names'
import {
  englishNameLikeness,
  japaneseNameLikeness,
  readsEnglishName,
  readsJapaneseName,
  type PokemonTextLanguage
} from '@shared/scan/pokemonLanguage'
import {
  ART_FAR_DISTANCE,
  ART_MATCH_DEPTH,
  ART_MAX_DISTANCE,
  PKM_ART_MIN_MARGIN,
  PKM_GUESS_NAME_LIKENESS,
  PKM_TWIN_MAYBE_ART,
  PKM_TWIN_OTHER_ART,
  PKM_GUESS_REPRINT_LEAD,
  PKM_GUESS_RULES,
  type PkmGuessRule
} from '@shared/scan/thresholds'
import type { ScanDraft, ScanPrinting } from '@shared/scan/types'
import type { RawSignals } from './engine'
import { pokemonVersion } from './vision/pokemonVersion'
import type { ResolveContext, ScanOutcome } from './resolve'

type Read = PokemonTextLanguage

/**
 * The cards whose art is close enough and within PKM_ART_MIN_MARGIN of the best, closest first. A
 * Pokémon card's English and Japanese twins share art, as do reprints, so they all come in and
 * the language or number decides between them rather than the margin. Null when the group
 * can't be trusted to be whole: an artwork in it is missing from the catalog, or every match
 * ranked falls inside the margin, so more may lie past the last.
 */
async function artGroup(raw: RawSignals, ctx: ResolveContext): Promise<number[] | null> {
  const [top] = raw.art
  if (!top || top.distance > ART_MAX_DISTANCE) return []
  const near = raw.art.filter(
    (a) => a.distance <= ART_MAX_DISTANCE && a.distance <= top.distance + PKM_ART_MIN_MARGIN
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

/**
 * Whether a card of the same name and language as card matched too, past the art group's margin
 * but within ART_MAX_DISTANCE: likely a reprint whose reference is a poor product photo, which
 * the art can't tell from card. Other cards' art that close is rare.
 */
async function reprintBehind(
  raw: RawSignals,
  card: ScanPrinting,
  ctx: ResolveContext
): Promise<boolean> {
  const [top] = raw.art
  const behind = raw.art.filter(
    (a) => a.distance > top.distance + PKM_ART_MIN_MARGIN && a.distance <= ART_MAX_DISTANCE
  )
  if (!behind.length) return false
  const cards = (await ctx.lookups.cardsForImages(behind.map((a) => a.imageId))).map(
    (c) => c.cardId
  )
  const others = await ctx.lookups.printingsForCards(cards.filter((id) => id !== card.cardId))
  return others.some((p) => p.language === card.language && sameName(p.name, card.name))
}

/**
 * Whether the closest artwork is more than PKM_ART_MIN_MARGIN ahead of the closest one of a card
 * of another name, over every match ranked: asked of art found only by the holder search, which
 * looks at many more quads and so has more chances of a chance match. A match whose card isn't
 * known, ranked before any other name, can't be told and fails. With no other name ranked at
 * all, any is further than the last, which artGroup has already seen past the margin.
 */
async function clearOfOtherNames(raw: RawSignals, ctx: ResolveContext): Promise<boolean> {
  const [top] = raw.art
  const cardOf = new Map(
    (await ctx.lookups.cardsForImages(raw.art.map((a) => a.imageId))).map((c) => [
      c.imageId,
      c.cardId
    ])
  )
  const nameOf = new Map(
    (await ctx.lookups.printingsForCards(unique([...cardOf.values()]))).map((p) => [
      p.cardId,
      p.name
    ])
  )
  const name = (imageId: number): string | undefined => {
    const cardId = cardOf.get(imageId)
    return cardId === undefined ? undefined : nameOf.get(cardId)
  }
  const topName = name(top.imageId)
  if (topName === undefined) return false
  for (const a of raw.art) {
    const other = name(a.imageId)
    if (other === undefined) return false
    if (!sameName(other, topName)) return a.distance > top.distance + PKM_ART_MIN_MARGIN
  }
  return true
}

/** How much closer the closest of cards' artworks is than the closest of the next card's. */
async function artLead(raw: RawSignals, cards: number[], ctx: ResolveContext): Promise<number> {
  const cardOf = new Map(
    (await ctx.lookups.cardsForImages(raw.art.map((a) => a.imageId))).map((c) => [
      c.imageId,
      c.cardId
    ])
  )
  const seen = new Set<number>()
  const closest: number[] = []
  for (const a of raw.art) {
    const cardId = cardOf.get(a.imageId)
    if (cardId === undefined || !cards.includes(cardId) || seen.has(cardId)) continue
    seen.add(cardId)
    closest.push(a.distance)
  }
  return closest.length < 2 ? Infinity : closest[1] - closest[0]
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

/** A set code's collector number, as printed: "BLK 085/86" and "85/86" are one number. */
const numberOf = (code: string): string =>
  (code.trim().split(/\s+/).at(-1) ?? '').replace(/^0+(?=\d)/, '')

/** Printed rarities, lowercased, that are mostly not foil. Any other rarity is a holo. */
const PLAIN_RARITIES = new Set(['common', 'uncommon', 'rare', 'promo', 'none'])

/** The usual versions of a card of this printed rarity, likeliest first. */
const baseVersions = (printedRarity: string | null | undefined): string[] =>
  !printedRarity || PLAIN_RARITIES.has(printedRarity.toLowerCase())
    ? ['Normal', 'Holofoil']
    : ['Holofoil', 'Normal']

/**
 * The card's draft, its versions to pick from: sure when it has one, else set to the version most
 * copies of its printed rarity are (baseVersions), flagged check-rarity, else flagged pick-printing
 * on the cheapest, which is only a placeholder (the overlay shows the range across them). A reverse holo is often the
 * cheapest, and the foil can't tell one yet.
 */
async function draft(
  cardId: number,
  raw: RawSignals,
  ctx: ResolveContext,
  via: 'code' | 'art'
): Promise<ScanDraft | null> {
  const options = await ctx.lookups.printingsForCards([cardId])
  if (!options.length) return null
  const cheapest = (list: ScanPrinting[]): ScanPrinting =>
    list.reduce((a, b) => ((b.price ?? Infinity) < (a.price ?? Infinity) ? b : a))
  const printing = cheapest(options)
  const plain =
    baseVersions(options[0].printedRarity)
      .map((label) => options.filter((o) => o.rarity === label))
      .find((list) => list.length) ?? []
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
  const named = label === null ? null : options.filter((o) => o.rarity === label)
  const chosen = named?.length === 1 ? named[0] : plain.length ? cheapest(plain) : printing
  return {
    cardId,
    name: printing.name,
    imageId,
    printingId: chosen.printingId,
    setCode: chosen.setCode,
    rarity: chosen.rarity,
    options,
    flag:
      options.length === 1 || named?.length === 1
        ? null
        : plain.length
          ? 'check-rarity'
          : 'pick-printing',
    via,
    game: 'pkm',
    // Priced as the raw card either way; the key is left out for a bare one.
    ...(raw.slab ? { slab: true as const } : {})
  }
}

/**
 * What a frame shows of a Pokémon card, named for certain only when art, number and language
 * agree on one card; else, where a PKM_GUESS_RULES rule allows, named as a best guess (`guess` on
 * the draft). A Chinese, European (or any other uncatalogued) card shares its art and often its number
 * with a Japanese or English twin, so a card is named only in a language read as English or
 * Japanese; anything else, unread included, is `unsure` unless the name band nearly reads a
 * name of the art's cards (likelyInLanguage).
 *
 * - With a collector number read: the art's cards that carry it, or with no art close, the
 *   number's cards a name read agrees with; one of them in the read language is named,
 *   `via: 'code'`.
 * - Without: the art's cards; one of them in the read language is named.
 * - Either way, never a card with a reprint of its art that has no artwork to match
 *   (ScanPrinting.unseenTwin).
 * - Art found only by the holder search (artVia), never unless it is past the margin from every
 *   card of another name (clearOfOtherNames).
 * - Nothing at all, and the closest artwork past ART_FAR_DISTANCE: `none`, far.
 *
 * The language is read only once there's a card to name, and at most once; a read that fails
 * counts as unread. Unread, a card is still named when its name band reads as its English or
 * printed Japanese name (Chinese prints neither Latin names nor kana); the name decides only
 * among the cards the art and number already allow.
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
  let names: Promise<string[]> | null = null
  const localNames = (): Promise<string[]> =>
    (names ??= Promise.resolve()
      .then(() => ctx.readLocalName?.() ?? [])
      .catch(() => []))

  const group = await artGroup(raw, ctx)
  if (group === null) return unsure
  const rules = ctx.guessRules ?? PKM_GUESS_RULES
  // Set once a rule has let something past that certainty wouldn't have.
  let guess = false
  const may = (rule: PkmGuessRule): boolean => {
    if (rules.includes(rule)) guess = true
    return rules.includes(rule)
  }
  if (
    raw.artVia === 'holder' &&
    group.length &&
    !(await clearOfOtherNames(raw, ctx)) &&
    !may('holder')
  )
    return unsure
  const numbered = await byNumber(raw, ctx)
  // A card with a reprint of its art that has no artwork of its own is named only as a guess: the
  // art can't tell them apart. A number read can, unless the reprint prints the same one, as a
  // Classic Collection reprint does its original's.
  // Nor is it a reprint when its product photo is other art: same name, same illustrator. A photo
  // only nearly that far could be either, so the card is named, marked as a guess.
  const untold = async (p: ScanPrinting): Promise<'yes' | 'maybe' | false> => {
    if (!p.unseenTwin) return false
    const read = numbered.filter((n) => n.cardId === p.cardId).map((n) => numberOf(n.setCode))
    const told = !!p.unseenTwinCodes?.length && read.length > 0
    if (told && !p.unseenTwinCodes!.some((c) => read.includes(numberOf(c)))) return false
    const twins = p.unseenTwinImages ?? []
    if (!ctx.artDistance || !twins.length || twins.length < new Set(p.unseenTwinCodes).size)
      return 'yes'
    let closest = Infinity
    for (const twin of twins) {
      for (const own of p.imageIds) {
        const distance = await ctx.artDistance(own, twin)
        if (distance === null) return 'yes'
        closest = Math.min(closest, distance)
      }
    }
    if (closest >= PKM_TWIN_OTHER_ART) return false
    return closest < PKM_TWIN_MAYBE_ART ? 'yes' : 'maybe'
  }
  const named = async (cardId: number, via: 'code' | 'art'): Promise<ScanOutcome> => {
    const item = await draft(cardId, raw, ctx, via)
    if (!item) return unsure
    const twinned = item.options.filter((p) => p.unseenTwin)
    const twin = twinned.length ? await untold(twinned[0]) : false
    if (twin && !may(twin === 'maybe' ? 'twin-maybe' : 'twin')) return unsure
    return { kind: 'recognized', item: guess ? { ...item, guess: true } : item }
  }

  /**
   * The cards among printings in the language read. With no language read, the name band
   * decides, never against the art: the English cards whose name the English read shows
   * (readsEnglishName), or the Japanese ones whose printed name the Japanese read shows
   * (readsJapaneseName); neither when both do. Text read as kanji alone (which the Japanese
   * model makes of a blurred English text box and of Chinese text alike) leaves the English name
   * only: a Chinese card prints its name in Chinese. Only with the art agreeing: without it, the
   * name read already stands for the card.
   */
  const inLanguage = async (printings: ScanPrinting[]): Promise<number[]> => {
    const lang = await language()
    if (lang === 'other') return []
    if (lang === 'en' || lang === 'ja')
      return unique(printings.filter((p) => p.language === lang).map((p) => p.cardId))
    if (!group.length) return []
    const en = printings.filter(
      (p) => p.language === 'en' && raw.nameTexts.some((r) => readsEnglishName(r, p.name))
    )
    if (lang === 'kanji') return unique(en.map((p) => p.cardId))
    const ja = printings.filter((p) => p.language === 'ja')
    const reads = ja.length ? await localNames() : []
    const jaNamed = ja.filter((p) => reads.some((r) => readsJapaneseName(r, p.localName ?? p.name)))
    if (en.length && jaNamed.length) return []
    return unique([...en, ...jaNamed].map((p) => p.cardId))
  }

  /**
   * With no language told, the cards whose name the name band nearly reads, in the language of the
   * nearest: Chinese text comes nowhere near either language's name, so the guess stays off a
   * Chinese card, which a guess at the language alone wouldn't.
   */
  const likelyInLanguage = async (printings: ScanPrinting[]): Promise<number[]> => {
    if (!rules.includes('language')) return []
    const lang = await language()
    if (lang !== null && lang !== 'kanji') return []
    const reads = await localNames()
    const likeness = (p: ScanPrinting): number =>
      p.language === 'en'
        ? englishNameLikeness(raw.nameTexts, p.name)
        : p.language === 'ja'
          ? japaneseNameLikeness(reads, p.localName ?? p.name)
          : 0
    const likely = printings.filter((p) => likeness(p) >= PKM_GUESS_NAME_LIKENESS)
    if (!likely.length) return []
    const nearest = likely.reduce((a, b) => (likeness(b) > likeness(a) ? b : a))
    return unique(likely.filter((p) => p.language === nearest.language).map((p) => p.cardId))
  }

  /**
   * The one card of printings to name: the language's, and when that leaves none or several, a
   * rule's best guess. Only among the art's cards, closest first; null when there's none.
   */
  const pick = async (printings: ScanPrinting[]): Promise<number | null> => {
    let ids = await inLanguage(printings)
    if (!group.length) return ids.length === 1 ? ids[0] : null
    if (!ids.length) {
      ids = await likelyInLanguage(printings)
      if (ids.length) may('language')
      else if ((await language()) === null && may('language-default'))
        ids = unique(printings.filter((p) => p.language === 'en').map((p) => p.cardId))
      if (!ids.length) return null
    }
    if (ids.length < 2) return ids[0] ?? null
    const closest = group.find((id) => ids.includes(id))!
    const name = printings.find((p) => p.cardId === closest)!.name
    const reprints = printings.every((p) => !ids.includes(p.cardId) || sameName(p.name, name))
    const lead = ctx.reprintLead ?? PKM_GUESS_REPRINT_LEAD
    if (!reprints || (await artLead(raw, ids, ctx)) < lead) return null
    return may('reprint') ? closest : null
  }

  if (numbered.length) {
    const name = group.length ? null : await nameRead(raw, ctx)
    const cards = numbered.filter((p) =>
      group.length
        ? group.includes(p.cardId)
        : !!name && (name.cardId === p.cardId || sameName(name.name, p.name))
    )
    if (cards.length) {
      const id = await pick(cards)
      return id === null ? unsure : named(id, 'code')
    }
    if (!group.length || !may('misread')) return unsure
  }

  if (!group.length) {
    const [top] = raw.art
    return top && top.distance > ART_FAR_DISTANCE ? { kind: 'none', far: true } : unsure
  }
  const printings = await ctx.lookups.printingsForCards(group)
  const id = await pick(printings)
  if (id === null) return unsure
  const card = printings.find((p) => p.cardId === id)!
  return (await reprintBehind(raw, card, ctx)) && !may('behind') ? unsure : named(id, 'art')
}
