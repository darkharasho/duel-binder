import { LANGUAGES, type Language } from '@shared/languages'
import { frameMagicCode, type MagicCodeRead } from '@shared/scan/magicCode'
import {
  ART_FAR_DISTANCE,
  ART_MATCH_DEPTH,
  ART_MAX_DISTANCE,
  ART_MAX_DISTANCE_IN_SET,
  MTG_ART_MIN_MARGIN,
  MTG_SAME_ART
} from '@shared/scan/thresholds'
import type { FinishLock } from '@shared/scan/finish'
import type { ScanDraft, ScanPrinting } from '@shared/scan/types'
import type { RawSignals } from './engine'
import type { ResolveContext, ScanOutcome } from './resolve'

export type { FinishLock }

/** A finish suffix on a Magic printing's rarity: "Rare (Foil)", "Rare (Etched Foil)". */
const FINISH = / \((Foil|Etched Foil)\)$/
const isFoil = (p: ScanPrinting): boolean => FINISH.test(p.rarity)
const plainRarity = (p: ScanPrinting): string => p.rarity.replace(FINISH, '')

/**
 * The same printing in the other finish: a non-foil's foil (" (Foil)", not etched), a foil's or
 * etched foil's non-foil; same card, set code and language. Null when it has no such twin.
 */
export function finishTwin(p: ScanPrinting, all: ScanPrinting[]): ScanPrinting | null {
  const want = isFoil(p) ? plainRarity(p) : `${p.rarity} (Foil)`
  return (
    all.find(
      (o) =>
        o.printingId !== p.printingId &&
        o.cardId === p.cardId &&
        o.setCode === p.setCode &&
        o.language === p.language &&
        o.rarity === want
    ) ?? null
  )
}

/**
 * Magic cards (game 'mtg'). A fingerprint record is a look (an illustration in one frame and
 * border); printingsOfArt turns it into every printing showing it, in every set, language and
 * finish. Three signals name the printing:
 *
 * - The info line ("C 0081" over "FRA • EN"): the first code read (frameMagicCode) the catalog knows.
 * - The art: the closest look, when close enough and MTG_ART_MIN_MARGIN ahead of the closest look
 *   of another card (a reprint or another look of the same card is no rival; one within
 *   MTG_SAME_ART of the closest is taken along, its printings among the choices).
 * - The name, only to pick among cards when the art's printings are of several.
 *
 * A read whose printings show the art's look is the printing. A read one character off one of
 * the art's printings is misread (the art stands, in the read's set when one of its printings is
 * there); a read of another card than confident art is unsure. A read alone or art alone names
 * the card; then the language (the info line's, else a picked set's, the language filter, the
 * text's, else English), the picked set, and the name narrow it. One set code left names the
 * printing; more ask the user to pick one. The finish: a printing's only one, else non-foil,
 * or foil under a foil lock. The info line's star doesn't claim foil (not yet trusted).
 */
export async function resolveMagicSignals(
  raw: RawSignals,
  ctx: ResolveContext
): Promise<ScanOutcome> {
  if (!raw.found) return { kind: 'none' }
  let read: MagicCodeRead | null = null
  let byRead: ScanPrinting[] = []
  for (const r of frameMagicCode(raw.codeTexts)) {
    const found = await ctx.lookups.printingsByCode(r.code)
    if (found.length) {
      read = r
      byRead = found
      break
    }
  }
  const look = await confidentLook(raw, ctx)

  let pool: ScanPrinting[] = []
  let via: 'code' | 'art' = 'art'
  if (read && look) {
    const shown = new Set(look.map((p) => p.printingId))
    const agreed = byRead.filter((p) => shown.has(p.printingId))
    if (agreed.length) {
      pool = agreed
      via = 'code'
    } else if (look.some((p) => oneCharApart(p.setCode, read!.code))) {
      // The read gone wrong: the art stands, in the read's set when one of its printings is there.
      const set = setOf(read.code)
      const inSet = look.filter((p) => setOf(p.setCode) === set)
      pool = inSet.length ? inSet : look
      read = { ...read, code: '' }
    } else if (!byRead.some((p) => look.some((l) => l.name === p.name))) {
      return { kind: 'unsure' }
    } else {
      // Another look of the card the art shows: the code names it.
      pool = byRead
      via = 'code'
    }
  } else if (read) {
    pool = byRead
    via = 'code'
  } else if (look) {
    pool = look
  }
  const item = pool.length ? await choose(pool, raw, ctx, via, read) : null
  if (item) return { kind: 'recognized', item }
  const [top] = raw.art
  return top && top.distance > ART_FAR_DISTANCE ? { kind: 'none', far: true } : { kind: 'unsure' }
}

/** "FRA 107" → "FRA". */
const setOf = (code: string): string => code.toUpperCase().split(' ')[0]

/** Two codes of one length, one character apart: "FRA 107" and "FRA 108", "FRA 107" and "FRB 107". */
function oneCharApart(a: string, b: string): boolean {
  const x = a.toUpperCase()
  const y = b.toUpperCase()
  if (x.length !== y.length) return false
  let off = 0
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) off++
  return off === 1
}

/**
 * The printings of the closest look, when it is close enough and MTG_ART_MIN_MARGIN ahead of the
 * closest look of another card (by name, since a card's languages are cards of their own), with
 * those of the card's other looks within MTG_SAME_ART of it. A look the catalog doesn't know
 * counts as another card. With no other card in sight, the margin is unlimited if every candidate
 * was ranked, else it runs to the last match. Null without printingsOfArt.
 */
async function confidentLook(
  raw: RawSignals,
  ctx: ResolveContext
): Promise<ScanPrinting[] | null> {
  const [top] = raw.art
  const maxDistance = ctx.setPrintings ? ART_MAX_DISTANCE_IN_SET : ART_MAX_DISTANCE
  if (!top || top.distance > maxDistance || !ctx.lookups.printingsOfArt) return null
  const all = await ctx.lookups.printingsOfArt(raw.art.map((a) => a.imageId))
  const ofId = (id: number): ScanPrinting[] => all.filter((p) => p.artIds?.includes(id))
  const first = ofId(top.imageId)
  if (!first.length) return null
  const names = new Set(first.map((p) => p.name))
  const sameCard = (id: number): boolean => ofId(id).some((p) => names.has(p.name))
  const rival = raw.art.find((a) => !sameCard(a.imageId))
  const last = raw.art[raw.art.length - 1]
  const margin = rival
    ? rival.distance - top.distance
    : raw.art.length < ART_MATCH_DEPTH
      ? Infinity
      : last.distance - top.distance
  if (margin < MTG_ART_MIN_MARGIN) return null
  const near = raw.art.filter(
    (a) => a.imageId !== top.imageId && a.distance - top.distance <= MTG_SAME_ART && sameCard(a.imageId)
  )
  const out = [...first]
  for (const a of near)
    for (const p of ofId(a.imageId))
      if (names.has(p.name) && !out.some((o) => o.printingId === p.printingId)) out.push(p)
  return out
}

/** The language the card is taken in, among the languages `pool` comes in. */
async function languageOf(
  pool: ScanPrinting[],
  ctx: ResolveContext,
  read: MagicCodeRead | null
): Promise<Language | undefined> {
  const languages = LANGUAGES.filter((l) => pool.some((o) => o.language === l.code)).map(
    (l) => l.code
  )
  if (languages.length < 2) return languages[0]
  if (read?.language && languages.includes(read.language)) return read.language
  const inSet = (ctx.setPrintings ?? []).find((s) => pool.some((o) => o.printingId === s.printingId))
  if (inSet) return inSet.language
  if (ctx.filterLanguage && languages.includes(ctx.filterLanguage)) return ctx.filterLanguage
  const told = await ctx.cardLanguage?.(pool[0].cardId)
  const said = languages.find((l) => l === told)
  if (said) return said
  return languages.includes('en') ? 'en' : languages[0]
}

/** The printing the frame shows among `pool`, or the choices when several set codes are left. */
async function choose(
  pool: ScanPrinting[],
  raw: RawSignals,
  ctx: ResolveContext,
  via: 'code' | 'art',
  read: MagicCodeRead | null
): Promise<ScanDraft | null> {
  const language = await languageOf(pool, ctx, read)
  let left = pool.filter((p) => p.language === language)
  const picked = new Set((ctx.setPrintings ?? []).map((p) => p.printingId))
  const inSet = left.filter((p) => picked.has(p.printingId))
  if (inSet.length) left = inSet
  if (new Set(left.map((p) => p.cardId)).size > 1 && raw.nameTexts.length) {
    const named = await ctx.lookups.matchName(raw.nameTexts.join(' '))
    const ofName = named ? left.filter((p) => p.name === named.name) : []
    if (ofName.length) left = ofName
  }
  if (!left.length) return null
  // The look closest to the photo first, so the choices start with the likeliest.
  const distanceOf = new Map(raw.art.map((a) => [a.imageId, a.distance]))
  const artDistance = (p: ScanPrinting): number =>
    Math.min(Infinity, ...(p.artIds ?? p.imageIds).map((id) => distanceOf.get(id) ?? Infinity))
  left = [...left].sort((a, b) => artDistance(a) - artDistance(b))
  const codes = new Set(left.map((p) => p.setCode))
  const [first] = left
  const ofCode = left.filter((p) => p.setCode === first.setCode && p.cardId === first.cardId)
  const printing = withFinish(ofCode, ctx.finishLock ?? 'auto')
  const imageId = printing.imageIds[0] ?? raw.art[0]?.imageId
  if (imageId === undefined) return null
  const otherSet = ctx.setPrintings !== null && !inSet.length
  return {
    game: 'mtg',
    cardId: printing.cardId,
    name: printing.name,
    imageId,
    printingId: printing.printingId,
    setCode: printing.setCode,
    rarity: printing.rarity,
    options: codes.size > 1 ? left : pool,
    flag: otherSet ? 'other-set' : codes.size > 1 ? 'pick-printing' : null,
    via
  }
}

/**
 * One printing's finishes (same set code, card and language): its only one, else the foil under a
 * foil lock, else the non-foil.
 */
function withFinish(finishes: ScanPrinting[], lock: FinishLock): ScanPrinting {
  if (finishes.length === 1) return finishes[0]
  const plain = finishes.find((p) => !isFoil(p))
  const foil = finishes.find((p) => p.rarity.endsWith(' (Foil)'))
  if (lock === 'foil') return foil ?? plain ?? finishes[0]
  return plain ?? finishes[0]
}
