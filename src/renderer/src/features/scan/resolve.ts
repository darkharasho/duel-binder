import type { Api } from '@shared/ipc'
import { LANGUAGES } from '@shared/languages'
import { artVariantName } from '@shared/scan/fingerprintRefs'
import type { CardLanguage } from '@shared/scan/language'
import { lookCandidate, pickRarityByLook, type LookModel } from '@shared/scan/look'
import { pickRarity, pickRarityByCues, type RarityCues } from '@shared/scan/rarity'
import { setCodeCandidates } from '@shared/scan/setCode'
import {
  ART_FAR_DISTANCE,
  ART_MATCH_DEPTH,
  ART_MAX_DISTANCE,
  ART_MAX_DISTANCE_IN_SET,
  ART_MIN_MARGIN,
  ART_REF_MIN_MARGIN,
  ART_TONE_MIN_LEAD
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

/**
 * The printings among `among` that a reference scan picks out (see fingerprintRefs.ts): when a
 * Yugipedia scan of an art variant's printing matched the photo at least ART_REF_MIN_MARGIN closer
 * than its card art did, every printing among them in the same art variant as that scan's. The
 * whole variant, not just the scan's printings: an overframe Prismatic Secret, Grand Master and
 * Ultra Rare look alike, and some have no scan. Null when no scan does.
 *
 * An art printed in tones (a Manga-Style card's Color and Monochrome) is taken in the tone whose
 * scans matched at least ART_TONE_MIN_LEAD closer than every other tone's; otherwise, or when a
 * tone among them has no scan to compare, in all of its tones, for the user to pick.
 */
function artFamily(art: ArtMatch[], among: ScanPrinting[]): ScanPrinting[] | null {
  const variantOf = (p: ScanPrinting): string | null => artVariantName(p.rarity, p.variant)
  const variants = new Set<string>()
  /** Each variant's closest scan, whether close enough to pick it out or not. */
  const closest = new Map<string, number>()
  for (const m of art) {
    if (m.base === undefined || !m.refs) continue
    for (const r of m.refs) {
      const shown = new Set(
        among
          .filter((p) => r.printingIds.includes(p.printingId))
          .map(variantOf)
          .filter((v) => v !== null)
      )
      // A scan more than one art took (a gallery short of scans) says nothing of which.
      if (shown.size !== 1) continue
      const [variant] = shown
      closest.set(variant, Math.min(closest.get(variant) ?? Infinity, r.distance))
      if (r.distance > ART_MAX_DISTANCE || m.base - r.distance < ART_REF_MIN_MARGIN) continue
      variants.add(variant)
    }
  }
  if (variants.size === 0) return null
  const all = [...new Set(among.map(variantOf).filter((v) => v !== null))]
  const picked = new Set<string>()
  for (const variant of variants) {
    const art = toneOf(variant)?.art
    const tones = all.filter((v) => art !== undefined && toneOf(v)?.art === art)
    if (tones.length < 2) {
      picked.add(variant)
      continue
    }
    const distance = (v: string): number => closest.get(v) ?? Infinity
    const [best, ...rest] = tones.sort((a, b) => distance(a) - distance(b))
    const leads = rest.every(
      (v) => closest.has(v) && distance(v) - distance(best) >= ART_TONE_MIN_LEAD
    )
    for (const v of leads ? [best] : tones) picked.add(v)
  }
  return among.filter((p) => picked.has(variantOf(p) ?? ''))
}

/** "manga-style, monochrome" to its art and tone; null for a variant not in a tone. */
function toneOf(variant: string): { art: string; tone: string } | null {
  const m = /^(.+?),\s*(color|monochrome)$/.exec(variant)
  return m ? { art: m[1], tone: m[2] } : null
}

/**
 * The printing among same-code printings whose rarity pickRarity chooses, among the art family
 * a reference scan picked out (artFamily) when there is one, unless the rarity the user said the
 * stack is is among the printings but not the family: what the user said goes. `family` is the
 * family it chose among, or null. The family only preselects: whether the rarity is certain is
 * still told over all the printings (or by the user's rarity), since a scan's art doesn't tell
 * its foil.
 */
function choose(
  printings: ScanPrinting[],
  defaultRarity: string | null,
  family: ScanPrinting[] | null = null
): { printing: ScanPrinting; certain: boolean; family: ScanPrinting[] | null } {
  const pick = (among: ScanPrinting[]): { rarity: string; certain: boolean } =>
    pickRarity(
      among.map((p) => p.rarity),
      defaultRarity
    )
  const all = pick(printings)
  const ofFamily = family && pick(family)
  const useFamily = ofFamily && !(defaultRarity !== null && all.certain && !ofFamily.certain)
  const among = useFamily ? family! : printings
  const { rarity } = useFamily ? ofFamily : all
  const certain = all.certain || (!!useFamily && defaultRarity !== null && ofFamily.certain)
  return {
    printing: among.find((p) => p.rarity === rarity) ?? among[0],
    certain,
    family: useFamily ? family : null
  }
}

/** The draft's artPrintings, when a reference scan's family chose its printing. */
const artPrintings = (family: ScanPrinting[] | null): Pick<ScanDraft, 'artPrintings'> =>
  family ? { artPrintings: family.map((p) => p.printingId) } : {}

/** The first code candidate, over every code band read, that names a printing. */
async function byCode(raw: RawSignals, ctx: ResolveContext): Promise<ScanDraft | null> {
  const tried = new Set<string>()
  for (const text of raw.codeTexts) {
    for (const code of setCodeCandidates(text)) {
      if (tried.has(code)) continue
      tried.add(code)
      const found = await ctx.lookups.printingsByCode(code)
      if (!found.length) continue
      const { printing, certain, family } = choose(
        found,
        ctx.defaultRarity,
        artFamily(raw.art, found)
      )
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
        via: 'code',
        ...artPrintings(family)
      }
    }
  }
  return null
}

/**
 * A card found by art or name within the picked set: its first code in the set, with the
 * rarity pickRarity chooses among that code's printings (or among its set printings of the art
 * family a reference scan picked out), and all its set printings to pick from.
 */
function inSet(
  cardId: number,
  art: ArtMatch[],
  ctx: ResolveContext,
  via: 'art' | 'name'
): ScanDraft | null {
  const own = (ctx.setPrintings ?? []).filter((p) => p.cardId === cardId)
  if (!own.length) return null
  const { printing, certain, family } = choose(
    own.filter((p) => p.setCode === own[0].setCode),
    ctx.defaultRarity,
    artFamily(art, own)
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
    via,
    ...artPrintings(family)
  }
}

/**
 * A card with no code read and no set to place it in: an assumed printing among all of its
 * printings, in the language its text reads as when it has printings in it, else in the first
 * language it has (English when it has one), of the rarity pickRarity chooses there (among the
 * art family a reference scan picked out there, if any), flagged for the user to check unless
 * the card was printed only once.
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
  const { printing, family } = choose(ofLanguage, ctx.defaultRarity, artFamily(art, ofLanguage))
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
    via,
    ...artPrintings(family)
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
 * The rarity look model and what it has to go on for a showing: each frame's look features
 * (rarityFeatures), the latest RARITY_MAX_READINGS of them.
 */
export interface LookInput {
  model: LookModel
  frames: readonly (readonly number[])[]
}

/**
 * The printings the look picks the rarity among: the draft's code's, in its language, and of its
 * art family when a reference scan picked one out.
 */
const lookOptions = (item: ScanDraft, current: ScanPrinting): ScanPrinting[] =>
  item.options.filter(
    (p) =>
      p.setCode === current.setCode &&
      p.language === current.language &&
      (!item.artPrintings || item.artPrintings.includes(p.printingId))
  )

/**
 * The draft with the rarity its look picks, under Auto (no default rarity), when the look
 * settles which of its code's rarities it is: no longer flagged Check rarity, and on the
 * printing of that rarity showing the draft's artwork when there is one. Unchanged when the
 * rarity was already certain, the user said what the stack is, or the look doesn't settle it.
 *
 * The look is the name and frame rules (pickRarityByCues), and with `look` (the phone scanner
 * only) the look model after them where they can't decide, under its guards and threshold
 * (pickRarityByLook). Without it, as on the desktop webcam, the rules alone.
 */
export function withRarityByLook(
  item: ScanDraft,
  cues: RarityCues | null,
  defaultRarity: string | null,
  look: LookInput | null = null
): ScanDraft {
  const current = item.options.find((p) => p.printingId === item.printingId)
  if (!current || defaultRarity !== null || !cues || (!cues.nameInk && !cues.surface)) return item
  const sameCode = lookOptions(item, current)
  const available = sameCode.map((p) => p.rarity)
  if (pickRarity(available, null).certain) return item
  const { rarity, certain } = look
    ? pickRarityByLook(look.model, available, cues, look.frames, current.frameType)
    : pickRarityByCues(available, cues, current.frameType)
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

/**
 * For checking the look model on real phone frames in development: the rules' pick and the
 * model's candidate (with its probability and whether the guards allow it) among the draft's
 * code's rarities, or null when withRarityByLook wouldn't consult them.
 */
export function describeLook(
  item: ScanDraft,
  cues: RarityCues | null,
  look: LookInput
): Record<string, unknown> | null {
  const current = item.options.find((p) => p.printingId === item.printingId)
  if (!current || !cues) return null
  const available = lookOptions(item, current).map((p) => p.rarity)
  if (pickRarity(available, null).certain) return null
  const rules = pickRarityByCues(available, cues, current.frameType)
  const candidate = lookCandidate(look.model, available, cues, look.frames, current.frameType)
  return {
    card: item.name,
    setCode: current.setCode,
    available,
    frames: look.frames.length,
    rules: rules.certain ? rules.rarity : null,
    look: candidate && {
      rarity: candidate.rarity,
      probability: Math.round(candidate.probability * 1e4) / 1e4,
      runnerUp: candidate.runnerUp,
      allowed: candidate.allowed,
      picks:
        !rules.certain && candidate.allowed && candidate.probability >= look.model.minProbability
    }
  }
}
