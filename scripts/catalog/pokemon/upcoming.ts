import type { TcCardRow, TcGroup, TdCard, TdSet } from './types'

/**
 * Mega Evolution sets TCGplayer already lists and TCGdex doesn't yet. TCGplayer publishes a set's
 * singles days before release, so these are built from its rows, with the ids TCGdex gives this
 * series ("me06", "me06-011"). When TCGdex adds the set it takes over the same cards, keys and
 * printings. TCGplayer warns that presale details can change; each night's run picks changes up.
 */
const NUMBERED_GROUP = /^ME(\d{2}(?:\.\d+)?):\s+(.+)$/

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
  'Hyper Rare': 'Hyper rare',
  'Shiny Rare': 'Shiny rare'
}

const plainText = (html: string): string => html.replace(/<[^>]+>/g, '').trim()

/** A product's card name: no number tail or side note, and Pokémon spelled as on the card. */
const cardName = (name: string): string =>
  name
    .replace(/\s+-\s*\d.*$/, '')
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

function categoryOf(cardType: string): string {
  if (cardType.startsWith('Trainer')) return 'Trainer'
  return /\bEnergy$/.test(cardType) ? 'Energy' : 'Pokemon'
}

function toCard(row: TcCardRow, set: { id: string; name: string }, localId: string): TdCard {
  const d = row.details
  const category = categoryOf(d['Card Type'] ?? '')
  const pokemon = category === 'Pokemon'
  const hp = Number(d.HP)
  return {
    id: `${set.id}-${localId}`,
    localId,
    name: cardName(row.name),
    category,
    rarity: d.Rarity ? (RARITIES[d.Rarity] ?? d.Rarity) : null,
    set,
    thirdParty: { tcgplayer: row.productId },
    ...(pokemon && {
      types: d['Card Type'] ? [d['Card Type']] : [],
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

const normalized = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

/** The groups to build a set from: numbered Mega Evolution groups TCGdex has no set for. */
export function upcomingGroups(groups: TcGroup[], known: TdSet[]): TcGroup[] {
  const ids = new Set(known.map((s) => s.id))
  const names = new Set(known.map((s) => normalized(s.name)))
  return groups.filter((g) => {
    const m = NUMBERED_GROUP.exec(g.name)
    return m !== null && !ids.has(`me${m[1]}`) && !names.has(normalized(m[2]))
  })
}

/** A group's set and cards, or null when it lists no numbered singles yet. */
export function upcomingSet(
  group: TcGroup,
  rows: TcCardRow[]
): { set: TdSet; cards: TdCard[] } | null {
  const m = NUMBERED_GROUP.exec(group.name)
  if (!m) return null
  const id = `me${m[1]}`
  const named = { id, name: m[2] }
  const byNumber = new Map<string, TcCardRow>()
  let official = 0
  for (const row of [...rows].sort((a, b) => a.productId - b.productId)) {
    const number = /^(\d+)\/(\d+)$/.exec(row.details.Number?.trim() ?? '')
    if (!number) continue
    official = Number(number[2])
    if (!byNumber.has(number[1])) byNumber.set(number[1], row)
  }
  if (byNumber.size === 0) return null
  const cards = [...byNumber]
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([localId, row]) => toCard(row, named, localId))
  return {
    set: {
      ...named,
      releaseDate: group.publishedOn?.slice(0, 10),
      serie: { id: 'me' },
      abbreviation: group.abbreviation ? { official: group.abbreviation } : undefined,
      cardCount: { official, total: cards.length },
      cards: cards.map((c) => ({ id: c.id, localId: c.localId, name: c.name }))
    },
    cards
  }
}
