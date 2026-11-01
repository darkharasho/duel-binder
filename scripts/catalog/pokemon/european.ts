import { bump, fold, majority } from './englishNames'
import { ENGLISH_VOCAB, LOCAL_VOCAB, type VocabKind } from './europeanVocab'
import type { EuropeanLang, PkmLang, TdCard, TdVariant } from './types'

/**
 * French, German, Italian and Spanish printings, from TCGdex's cards of each language. TCGdex writes
 * these cards' rarity, category, stage, types and variants in the language, so a card is turned into
 * the English vocabulary before anything else sees it: rarity and variants decide the version label,
 * which is part of the key, so a value the tables lack stops the language rather than being guessed.
 * Its text stays as printed. A card's TCGplayer ids are dropped: they are the English card's, and
 * TCGCSV sells none of these, so they have no product or price. They aren't scanned, and art is only
 * TCGdex's own image of the language.
 */

export const EUROPEAN_LANGS = ['fr', 'de', 'it', 'es'] as const satisfies readonly EuropeanLang[]

export const isEuropean = (lang: PkmLang): lang is EuropeanLang =>
  (EUROPEAN_LANGS as readonly string[]).includes(lang)

/** Turns a card into English words, adding any it can't to `unmapped`. */
function normalise(lang: EuropeanLang, card: TdCard, unmapped: Set<string>): TdCard {
  const english = (kind: VocabKind, value: string): string => {
    const v = value.trim()
    const mapped = LOCAL_VOCAB[lang][kind][v] ?? (ENGLISH_VOCAB[kind].includes(v) ? v : null)
    if (mapped === null) unmapped.add(`${kind} ${JSON.stringify(value)} (${card.id})`)
    return mapped ?? v
  }
  const variant = (v: TdVariant): TdVariant => ({
    ...v,
    type: english('variantType', v.type),
    ...(v.subtype ? { subtype: english('variantSubtype', v.subtype) } : {}),
    ...(v.stamp ? { stamp: v.stamp.map((s) => english('variantStamp', s)) } : {}),
    ...(v.foil ? { foil: english('variantFoil', v.foil) } : {}),
    thirdParty: undefined
  })
  const rarity = card.rarity ? english('rarity', card.rarity) : card.rarity
  return {
    ...card,
    // "None" is how TCGdex writes no rarity.
    rarity: rarity === 'None' ? null : rarity,
    ...(card.category ? { category: english('category', card.category) } : {}),
    ...(card.stage ? { stage: english('stage', card.stage) } : {}),
    ...(card.types ? { types: card.types.map((t) => english('types', t)) } : {}),
    variants_detailed: card.variants_detailed?.map(variant),
    thirdParty: undefined
  }
}

/**
 * The cards as the catalog takes them. Throws naming every value the tables lack, so one run shows
 * all of what a new set brought; the caller drops the language for the night.
 */
export function europeanCards(lang: EuropeanLang, cards: TdCard[]): TdCard[] {
  const unmapped = new Set<string>()
  const out = cards.map((c) => normalise(lang, c, unmapped))
  if (unmapped.size > 0) throw new Error(`Pokémon ${lang}: unmapped ${[...unmapped].join(', ')}`)
  return out
}

export const europeanCard = (lang: EuropeanLang, card: TdCard): TdCard =>
  europeanCards(lang, [card])[0]

export interface EuropeanNamer {
  nameOf(card: TdCard): string | null
}

/**
 * English names, tried in order:
 *  1. the English card of the same id. TCGdex keeps one file per card across these languages, so
 *     it's the same card; a different category or Pokédex number says otherwise, and it is passed over;
 *  2. for a card English lacks (the French-only McDonald's sets), the name most of the language's
 *     cards of this printed name and category have.
 * A wrong name is worse than the printed one, so a card neither names stays as printed.
 */
export function europeanNamer(cards: TdCard[], enCards: Iterable<TdCard>): EuropeanNamer {
  const byId = new Map<string, TdCard>()
  for (const c of enCards) byId.set(c.id, c)
  const twinName = (card: TdCard): string | null => {
    const twin = byId.get(card.id)
    if (!twin || twin.category !== card.category) return null
    const a = card.dexId ?? []
    const b = twin.dexId ?? []
    return a.length > 0 && b.length > 0 && !a.some((d) => b.includes(d)) ? null : twin.name
  }
  const key = (card: TdCard): string => `${card.category}\u0000${fold(card.name)}`
  const pairs = new Map<string, Map<string, number>>()
  for (const c of cards) {
    const name = twinName(c)
    if (name) bump(pairs, key(c), name)
  }
  return {
    nameOf(card) {
      const counts = pairs.get(key(card))
      return twinName(card) ?? (counts ? majority(counts) : null)
    }
  }
}
