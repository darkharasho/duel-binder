import {
  MTG_FORMATS,
  MTG_LEGALITY,
  RULES_SCHEMA,
  parseRulesPack,
  type MtgCommanderKind,
  type MtgRulesPack
} from '../pack'

/** The fields of a Scryfall oracle_cards object the builder reads. */
export interface MtgPackCard {
  name: string
  layout: string
  type_line?: string
  oracle_text?: string
  keywords?: string[]
  /** Printed power and toughness; only read to tell Vehicles and Spacecraft that can lead a deck. */
  power?: string
  toughness?: string
  legalities: Record<string, string>
  released_at: string
  reprint?: boolean
  digital?: boolean
  games?: string[]
  card_faces?: {
    name: string
    type_line?: string
    oracle_text?: string
    power?: string
    toughness?: string
  }[]
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10
}

/**
 * Cap from "up to <n> cards named" (or 0 for any number); null = normal limits.
 */
export function anyNumberCap(c: MtgPackCard): number | null {
  const text = [c.oracle_text, ...(c.card_faces ?? []).map((f) => f.oracle_text)]
    .filter(Boolean)
    .join('\n')
  if (text.includes('A deck can have any number of cards named')) return 0
  const m = /A deck can have up to (\w+) cards named/.exec(text)
  if (!m) return null
  const n = /^\d+$/.test(m[1]) ? Number(m[1]) : NUMBER_WORDS[m[1].toLowerCase()]
  return n ?? null
}

/**
 * Whether the card can lead a Commander deck, and which pairing rule it carries; null = can't.
 * Rules checked 2026-11-23: mtgcommander.net says "a legendary creature"; Wizards' Edge of Eternities
 * release notes (magic.wizards.com/en/news/feature/edge-of-eternities-release-notes) add "any
 * legendary Vehicle or Spacecraft card with a printed power and toughness can now be your commander".
 * Planeswalkers need "can be your commander" text; Backgrounds are legendary enchantments.
 */
export function commanderKind(c: MtgPackCard): MtgCommanderKind | null {
  const front = c.card_faces?.[0] ?? c
  const type = front.type_line ?? c.type_line ?? ''
  const text = front.oracle_text ?? ''
  const allText = [c.oracle_text, ...(c.card_faces ?? []).map((f) => f.oracle_text)]
    .filter(Boolean)
    .join('\n')
  const legendary = type.includes('Legendary')
  const isBackground = legendary && type.includes('Background')
  const hasPT = front.power !== undefined && front.toughness !== undefined
  const vehicle = legendary && hasPT && (type.includes('Vehicle') || type.includes('Spacecraft'))
  const eligible =
    (legendary && type.includes('Creature')) ||
    vehicle ||
    allText.includes('can be your commander') ||
    isBackground
  if (!eligible) return null
  if (isBackground) return 'background'
  const withName = /Partner with ([^\n(]+?)\s*(?:\(|\n|$)/.exec(text)
  if (withName) return `partner-with:${withName[1].trim()}`
  const variant = /Partner—([^\n(]+?)\s*(?:\(|\n|$)/.exec(text)
  if (variant) return `variant:${variant[1].trim()}`
  const kw = c.keywords ?? []
  if (kw.includes('Partner')) return 'partner'
  if (text.includes('Friends forever')) return 'friends'
  if (text.includes('Choose a Background')) return 'background-chooser'
  if (text.includes("Doctor's companion")) return 'companion'
  if (type.includes('Time Lord Doctor')) return 'doctor'
  return ''
}

function legalBits(c: MtgPackCard): number {
  let bits = 0
  MTG_FORMATS.forEach((f, i) => {
    const v = c.legalities[f]
    const n =
      v === 'legal'
        ? MTG_LEGALITY.legal
        : v === 'restricted'
          ? MTG_LEGALITY.restricted
          : v === 'banned'
            ? MTG_LEGALITY.banned
            : MTG_LEGALITY.notLegal
    bits |= n << (2 * i)
  })
  return bits
}

/** Builds the Magic rules pack from Scryfall oracle cards; throws when the result doesn't parse. */
export function buildMtgPack(
  cards: Iterable<MtgPackCard>,
  o: { version: string; builtAt: Date }
): MtgRulesPack {
  const today = o.builtAt.toISOString().slice(0, 10)
  const pack: MtgRulesPack = {
    schema: RULES_SCHEMA,
    game: 'mtg',
    version: o.version,
    builtAt: o.builtAt.toISOString(),
    sources: [{ name: 'Scryfall', fetchedAt: o.version }],
    formats: [...MTG_FORMATS],
    legal: {},
    anyNumber: {},
    commander: {},
    upcoming: {}
  }
  for (const c of cards) {
    if (c.digital || !c.games?.includes('paper') || c.name.startsWith('A-')) continue
    const bits = legalBits(c)
    if (bits === 0) continue
    pack.legal[c.name] = bits
    const cap = anyNumberCap(c)
    if (cap !== null) pack.anyNumber[c.name] = cap
    const kind = commanderKind(c)
    if (kind !== null) pack.commander[c.name] = kind
    if (c.released_at > today && c.reprint !== true) pack.upcoming[c.name] = c.released_at
  }
  if (parseRulesPack(pack).state !== 'ready') throw new Error('Built Magic rules pack is invalid')
  return pack
}
