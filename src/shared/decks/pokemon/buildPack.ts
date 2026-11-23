import { normalCardName } from '../names'
import {
  PKM_FLAG,
  PKM_LEGAL,
  RULES_SCHEMA,
  packKeyOfId,
  splitCardId,
  type PkmKey,
  type PkmRulesPack
} from '../pack'

export interface PkmPackCard {
  id: string
  name: string
  category?: string
  stage?: string
  rarity?: string | null
  energyType?: string
  legal?: { standard?: boolean; expanded?: boolean }
  attacks?: { name: string }[]
  abilities?: { name: string }[]
}

export interface PkmManual {
  banned: { standard: string[]; expanded: string[] }
  override: Record<string, { standard?: boolean; expanded?: boolean }>
}

/** Fewer English cards than this means the fetch was partial; the pack isn't published. */
export const MIN_ENGLISH_CARDS = 15000

const names = (xs?: { name: string }[]): string =>
  (xs ?? [])
    .map((x) => normalCardName(x.name))
    .sort()
    .join(',')

/** One rules identity: the name, its attacks and its abilities, so reprints share it. */
export function cardKeyOf(c: PkmPackCard): string {
  const key = `${normalCardName(c.name)}|${names(c.attacks)}|${names(c.abilities)}`
  // Old sets print a Special Energy under the basic one's name.
  return c.category === 'Energy' ? `${key}|${c.energyType === 'Normal' ? 'basic' : 'special'}` : key
}

function flagsOf(c: PkmPackCard): number {
  let f = 0
  if (c.stage === 'Basic') f |= PKM_FLAG.basic
  if (c.rarity === 'ACE SPEC Rare' || c.rarity === 'Rare ACE') f |= PKM_FLAG.aceSpec
  if (c.name.startsWith('Radiant ')) f |= PKM_FLAG.radiant
  if (c.category === 'Energy' && c.energyType === 'Normal') f |= PKM_FLAG.basicEnergy
  return f
}

const KIND: Record<string, PkmKey['k']> = { Pokemon: 'P', Trainer: 'T', Energy: 'E' }

export function buildPkmPack(
  cards: PkmPackCard[],
  manual: PkmManual,
  builtAt: Date,
  minCards: number = MIN_ENGLISH_CARDS
): PkmRulesPack {
  if (cards.length < minCards)
    throw new Error(`Only ${cards.length} Pokémon cards; expected at least ${minCards}`)
  const index = new Map<string, number>()
  const keys: PkmKey[] = []
  const ids: PkmRulesPack['ids'] = {}
  for (const c of cards) {
    const ck = cardKeyOf(c)
    let i = index.get(ck)
    if (i === undefined) {
      i = keys.length
      index.set(ck, i)
      keys.push({ n: c.name, k: KIND[c.category ?? ''] ?? 'P', f: 0, l: 0 })
    }
    keys[i].f |= flagsOf(c)
    if (c.legal?.standard) keys[i].l |= PKM_LEGAL.standard
    if (c.legal?.expanded) keys[i].l |= PKM_LEGAL.expanded
    const [set, local] = splitCardId(c.id)
    ;(ids[set] ??= {})[local] = i
  }
  const keyOf = (id: string): number => {
    const i = packKeyOfId({ ids } as PkmRulesPack, id)
    if (i === undefined) throw new Error(`Manual list names ${id}, which isn't in the cards`)
    return i
  }
  const banned = (list: string[]): number[] => [...new Set(list.map(keyOf))]
  const standard = banned(manual.banned.standard)
  const expanded = banned(manual.banned.expanded)
  for (const [id, o] of Object.entries(manual.override)) {
    const i = keyOf(id)
    if (o.standard !== undefined)
      keys[i].l = o.standard ? keys[i].l | PKM_LEGAL.standard : keys[i].l & ~PKM_LEGAL.standard
    if (o.expanded !== undefined)
      keys[i].l = o.expanded ? keys[i].l | PKM_LEGAL.expanded : keys[i].l & ~PKM_LEGAL.expanded
  }
  const at = builtAt.toISOString()
  return {
    schema: RULES_SCHEMA,
    game: 'pkm',
    version: at.slice(0, 10),
    builtAt: at,
    sources: [{ name: 'TCGdex', fetchedAt: at }],
    keys,
    ids,
    formats: { standard: { banned: standard }, expanded: { banned: expanded } }
  }
}
