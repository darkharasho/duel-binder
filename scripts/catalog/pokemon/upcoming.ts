import { notes } from './art'
import { isSameNumber, numberPart, OWN_NUMBERS } from './match'
import { productTreatment } from './versions'
import type { TcCardRow, TcGroup, TcProduct, TdCard, TdLang, TdSet, TdVariant } from './types'

/**
 * Mega Evolution sets TCGplayer already lists and TCGdex doesn't yet. TCGplayer publishes a set's
 * singles days before release, so these are built from its rows, with the ids TCGdex gives this
 * series ("me06", "me06-011"; in Japan "M6a", "M6a-001"). When TCGdex adds the set it takes over
 * the same cards, keys and printings. TCGplayer warns that presale details can change; each night's
 * run picks changes up. tcgplayerOnlyCards does the same for cards missing from a set TCGdex has.
 */
const NUMBERED_GROUP = /^ME(\d{2}(?:\.\d+)?):\s+(.+)$/

/** A Japanese Mega era group: "M6a: MEGA Expansion 30th Celebration", "MF: 30th CELEBRATION ...". */
const JAPAN_GROUP = /^(m[a-z0-9]{0,4}):\s+(.+)$/i

/** The series TCGdex is still filling in; older gaps are TCGplayer's own groupings and reprints. */
const RECENT_SERIES: ReadonlySet<string> = new Set(['me', 'M'])

const COSTS: Record<string, string> = {
  G: 'Grass',
  R: 'Fire',
  W: 'Water',
  L: 'Lightning',
  P: 'Psychic',
  F: 'Fighting',
  D: 'Darkness',
  M: 'Metal',
  Y: 'Fairy',
  N: 'Dragon',
  C: 'Colorless'
}

/** TCGplayer's rarities that TCGdex spells differently. */
const RARITIES: Record<string, string> = {
  'Double Rare': 'Double rare',
  'Illustration Rare': 'Illustration rare',
  'Special Illustration Rare': 'Special illustration rare',
  'Art Rare': 'Illustration rare',
  'Special Art Rare': 'Special illustration rare',
  'Hyper Rare': 'Hyper rare',
  'Shiny Rare': 'Shiny rare'
}

const plainText = (html: string): string => html.replace(/<[^>]+>/g, '').trim()

/** A product's card name: no number tail or side note, and Pokémon spelled as on the card. */
const cardName = (name: string): string =>
  name
    .replace(/\s+-\s*\S*[\d/].*$/, '')
    .replace(/\s*[([].*$/, '')
    .replace(/\bPokemon\b/g, 'Pokémon')
    .trim()

/** "[G] Finishing Blow (60+)<br> Effect." as a TCGdex attack. */
export function parseAttack(text: string): NonNullable<TdCard['attacks']>[number] | null {
  const m = /^\[([^\]]*)\]\s*(.+?)(?:\s*\(([^()]+)\))?\s*(?:<br>\s*([\s\S]*))?$/.exec(text.trim())
  if (!m) return null
  return {
    cost: [...m[1]].flatMap((c) => COSTS[c] ?? []),
    name: m[2],
    ...(m[3] ? { damage: m[3] } : {}),
    ...(m[4] ? { effect: plainText(m[4]) } : {})
  }
}

/** The abilities in a Pokémon's card text ("<strong>Ability: Name</strong> Effect."). */
function parseAbilities(text: string | undefined): NonNullable<TdCard['abilities']> {
  const parts = (text ?? '').split(/<strong>Ability:\s*/).slice(1)
  return parts.flatMap((part) => {
    const m = /^(.+?)<\/strong>([\s\S]*)$/.exec(part)
    return m ? [{ type: 'Ability', name: plainText(m[1]), effect: plainText(m[2]) }] : []
  })
}

/** A row's category. TCGplayer's Japanese rows may not say; write.ts then asks the English cards. */
function categoryOf(cardType: string, name: string): string | undefined {
  if (/\bEnergy$/.test(cardType) || /\bEnergy$/.test(name)) return 'Energy'
  if (!cardType) return undefined
  return /^(?:Trainer|Supporter|Item|Stadium)/.test(cardType) ? 'Trainer' : 'Pokemon'
}

function toCard(
  row: TcCardRow,
  set: { id: string; name: string },
  localId: string,
  printed?: string
): TdCard {
  const d = row.details
  // Category 85 spells it "CardType".
  const cardType = d['Card Type'] ?? d.CardType ?? ''
  const name = cardName(row.name)
  const category = categoryOf(cardType, name)
  const pokemon = category === 'Pokemon'
  const hp = Number(d.HP)
  return {
    id: `${set.id}-${localId}`,
    localId,
    name,
    category,
    rarity: d.Rarity && d.Rarity !== 'None' ? (RARITIES[d.Rarity] ?? d.Rarity) : null,
    set,
    thirdParty: { tcgplayer: row.productId },
    fromTcgplayer: true,
    ...(printed ? { printed } : {}),
    ...(pokemon && {
      types: cardType ? [cardType] : [],
      ...(Number.isFinite(hp) && hp > 0 ? { hp } : {}),
      ...(d.Stage ? { stage: d.Stage.replace(/\s+/g, '') } : {}),
      abilities: parseAbilities(d.CardText),
      attacks: [d['Attack 1'], d['Attack 2'], d['Attack 3']].flatMap((a) => {
        const attack = a ? parseAttack(a) : null
        return attack ? [attack] : []
      })
    })
  }
}

/** A number of letters: a Mew's "R/RGB", a basic Energy's "DAR". TCGdex's id is what's before the slash. */
const LETTER_NUMBER = /^[A-Z]+(?:\/[A-Z]+)?$/

const normalized = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

/** The set a group would be, with the id TCGdex would give it. "m1L" is its "M1L". */
function setOfGroup(group: TcGroup, lang: TdLang): { id: string; name: string } | null {
  if (lang === 'en') {
    const m = NUMBERED_GROUP.exec(group.name)
    return m && { id: `me${m[1]}`, name: m[2] }
  }
  const m = JAPAN_GROUP.exec(group.name)
  return m && { id: `M${m[1].slice(1)}`, name: m[2] }
}

/**
 * The groups to build a set from: the numbered Mega Evolution groups, and Japan's Mega era groups,
 * that TCGdex has no set for. Japanese sets are compared by id alone, their names being Japanese.
 */
export function upcomingGroups(groups: TcGroup[], known: TdSet[], lang: TdLang = 'en'): TcGroup[] {
  const ids = new Set(known.map((s) => s.id.toLowerCase()))
  const names = new Set(known.map((s) => normalized(s.name)))
  return groups.filter((g) => {
    const set = setOfGroup(g, lang)
    return (
      set !== null &&
      !ids.has(set.id.toLowerCase()) &&
      (lang !== 'en' || !names.has(normalized(set.name)))
    )
  })
}

/** Numbers past the digits ("R", "DAR") go last, as TCGdex's and the set grid's do. */
const numberRank = (localId: string): number => (/^\d/.test(localId) ? Number(localId) : Infinity)

/** A group's set and cards, or null when it lists no numbered singles yet. */
export function upcomingSet(
  group: TcGroup,
  rows: TcCardRow[],
  lang: TdLang = 'en'
): { set: TdSet; cards: TdCard[] } | null {
  const named = setOfGroup(group, lang)
  if (!named) return null
  const byNumber = new Map<string, TcCardRow>()
  let official = 0
  for (const row of [...rows].sort((a, b) => a.productId - b.productId)) {
    const raw = row.details.Number?.trim() ?? ''
    const number = /^(\d+)\/(\d+)$/.exec(raw)
    if (number) official = Number(number[2])
    else if (!LETTER_NUMBER.test(raw)) continue
    const localId = number?.[1] ?? numberPart(raw)
    if (!byNumber.has(localId)) byNumber.set(localId, row)
  }
  if (byNumber.size === 0) return null
  const cards = [...byNumber]
    .sort(([a], [b]) => (numberRank(a) === numberRank(b) ? 0 : numberRank(a) - numberRank(b)))
    .map(([localId, row]) =>
      toCard(row, named, localId, /^\d/.test(localId) ? undefined : row.details.Number.trim())
    )
  return {
    set: {
      ...named,
      releaseDate: group.publishedOn?.slice(0, 10),
      serie: { id: lang === 'en' ? 'me' : 'M' },
      // Japan's sets have none in TCGdex; their codes are the id in upper case ("M2A").
      abbreviation: lang === 'en' && group.abbreviation ? { official: group.abbreviation } : undefined,
      cardCount: { official, total: cards.length },
      cards: cards.map((c) => ({ id: c.id, localId: c.localId, name: c.name }))
    },
    cards
  }
}

/** A printed number a card can have: "101", "101/128", "R/RGB", "052/M-P". */
const CARD_NUMBER = /^[A-Za-z0-9]+(?:\/[A-Za-z0-9-]+)?$/

const claimedProducts = (cards: TdCard[]): Set<number> =>
  new Set(
    cards.flatMap((c) =>
      [...(c.variants_detailed ?? []).map((v) => v.thirdParty?.tcgplayer), c.thirdParty?.tcgplayer].filter(
        (id): id is number => typeof id === 'number'
      )
    )
  )

/**
 * One number's card from its products. Their name must agree, and the card is the product with no
 * note of its own: notes all of them share ("(30th Celebration)") say nothing. Every other product
 * must add one note, and is a version of the card: a foil pattern as itself, anything else
 * ("(Pokemon Center Exclusive)", "[Staff]", "(Winner)") as a variant subtype, which keeps its own
 * label and price. The variants are marked generated: TCGplayer's rows are the finishes.
 */
function numberCard(
  set: { id: string; name: string },
  localId: string,
  products: TcProduct[]
): { card: TdCard | null; notes: string[] } {
  const rows = products.map((p) => ({ ...p, details: p.details ?? {} }))
  const say = (why: string): string => `${set.id}-${localId}: ${why}`
  const names = new Set(rows.map((r) => cardName(r.name)))
  if (names.size > 1) return { card: null, notes: [say(`products name ${[...names].join(', ')}; left out`)] }
  const all = rows.map((r) => notes(r.name))
  const own = all.map((list) => list.filter((n) => !all.every((other) => other.includes(n))))
  const plain = rows.filter((_, i) => own[i].length === 0)
  if (plain.length !== 1) {
    const list = rows.map((r) => r.name).join('; ')
    return { card: null, notes: [say(`no one plain product among ${list}; left out`)] }
  }
  const base = plain[0]
  const left: string[] = []
  const variants: TdVariant[] = [
    { type: 'normal', variantId: 'generated', thirdParty: { tcgplayer: base.productId } }
  ]
  rows.forEach((r, i) => {
    if (r === base) return
    if (own[i].length !== 1) return void left.push(say(`"${r.name}" left out, its notes don't say one version`))
    const subtype = productTreatment(r.name) ? undefined : own[i][0]
    variants.push({
      type: 'normal',
      variantId: 'generated',
      ...(subtype ? { subtype } : {}),
      thirdParty: { tcgplayer: r.productId }
    })
  })
  const printed = base.number!.trim()
  return { card: { ...toCard(base, set, localId, printed), variants_detailed: variants }, notes: left }
}

/**
 * Cards TCGplayer lists in the group of a recent set and TCGdex doesn't have yet, with the set's id
 * and the ids TCGdex would give them: the number before the slash, as its "exu-!" and "mep-Museum"
 * show, so "R/RGB" is "30th-R". A wrong card is worse than a missing one, so a product must have a
 * picture, no other card's id, and the set's count if it has a numeric count ("151/165" in a set of
 * 63 is a deck card filed there); anything left out is said in `notes`.
 */
export function tcgplayerOnlyCards(
  set: TdSet,
  cards: TdCard[],
  products: TcProduct[]
): { cards: TdCard[]; notes: string[] } {
  if (!RECENT_SERIES.has(set.serie?.id ?? '') || OWN_NUMBERS.has(set.id)) return { cards: [], notes: [] }
  const claimed = claimedProducts(cards)
  const official = set.cardCount?.official ?? 0
  const out: string[] = []
  const byNumber = new Map<string, TcProduct[]>()
  for (const p of [...products].sort((a, b) => a.productId - b.productId)) {
    const number = p.number?.trim()
    if (!number || claimed.has(p.productId) || /code card/i.test(p.name)) continue
    if (cards.some((c) => isSameNumber(c.localId, number))) continue
    const count = /\/(\d+)$/.exec(number)
    if (!CARD_NUMBER.test(number) || (count && official > 0 && Number(count[1]) !== official)) {
      out.push(`${set.id}: "${p.name}" numbered ${number} left out`)
    } else if (!p.imageUrl) {
      out.push(`${set.id}: "${p.name}" left out, no picture yet`)
    } else {
      const id = numberPart(number)
      byNumber.set(id, [...(byNumber.get(id) ?? []), p])
    }
  }
  const named = { id: set.id, name: set.name }
  const built: TdCard[] = []
  for (const [localId, rows] of byNumber) {
    const r = numberCard(named, localId, rows)
    out.push(...r.notes)
    if (r.card) built.push(r.card)
  }
  return { cards: built, notes: out }
}
