import { MAX_PROBLEM_KEY, type DeckProblem } from '../check'
import type { DeckFormat } from '../formats'
import { normalCardName } from '../names'
import { PKM_FLAG, PKM_LEGAL, type PkmRulesPack } from '../pack'
import type { DeckCard, WireDeck } from '../types'
import { keyIndex, keyOfCard, pkmKind } from './keys'

const BASIC_ENERGY_NAME =
  /^(basic )?(grass|fire|water|lightning|psychic|fighting|darkness|metal|fairy) energy$/

export function checkPkm(
  deck: Pick<WireDeck, 'format' | 'cards'>,
  format: DeckFormat,
  cards: Record<number, DeckCard>,
  pack: PkmRulesPack | null
): DeckProblem[] {
  const out: DeckProblem[] = []
  const nameOf = (id: number): string => cards[id]?.name ?? `Card #${id}`
  const index = pack ? keyIndex(pack) : null

  const perCard = new Map<number, number>()
  let total = 0
  for (const e of deck.cards) {
    total += e.qty
    perCard.set(e.card, (perCard.get(e.card) ?? 0) + e.qty)
  }

  const section = format.sections[0]
  if (total !== section.min) {
    out.push({
      key: 'count:main',
      severity: 'error',
      section: 'main',
      message: `Deck has ${total} cards; it needs exactly ${section.min}`
    })
  }

  interface Facts {
    id: number
    qty: number
    card: DeckCard | undefined
    /** the card's rules keys: one, several (unsure) or none */
    keys: number[]
    unsure: boolean
  }
  const facts: Facts[] = []
  for (const [id, qty] of perCard) {
    const card = cards[id]
    let keys: number[] = []
    let unsure = false
    if (card && pack && index) {
      const hit = keyOfCard(card, pack, index)
      if ('key' in hit) keys = [hit.key]
      else if ('unsure' in hit) {
        keys = hit.unsure
        unsure = true
      }
    }
    facts.push({ id, qty, card, keys, unsure })
  }

  // Copies: by name, except basic Energy.
  const groups = new Map<string, { n: number; name: string; allBasicEnergy: boolean }>()
  for (const f of facts) {
    const name = f.card?.name ?? nameOf(f.id)
    const keyed = !f.unsure && f.keys.length === 1 && pack
    const norm = normalCardName(keyed ? pack.keys[f.keys[0]].n : name)
    const byName =
      !!f.card && pkmKind(f.card.type) === 'E' && BASIC_ENERGY_NAME.test(normalCardName(name))
    const basicEnergy =
      byName || (!!pack && f.keys.some((k) => (pack.keys[k].f & PKM_FLAG.basicEnergy) !== 0))
    const g = groups.get(norm)
    if (g) {
      g.n += f.qty
      g.allBasicEnergy &&= basicEnergy
    } else groups.set(norm, { n: f.qty, name, allBasicEnergy: basicEnergy })
  }
  for (const [norm, g] of groups) {
    if (g.n > 4 && !g.allBasicEnergy) {
      out.push({
        key: `copies:${norm}`.slice(0, MAX_PROBLEM_KEY),
        severity: 'error',
        message: `${g.n} × ${g.name}: at most 4 copies of cards with the same name`
      })
    }
  }

  if (!pack) return out

  const has = (f: Facts, flag: number): boolean => f.keys.some((k) => (pack.keys[k].f & flag) !== 0)
  const fid = format.id as 'standard' | 'expanded'
  const legalBit = PKM_LEGAL[fid]
  const banned = new Set(pack.formats[fid].banned)

  let ace = 0
  let radiant = 0
  let basic = false
  for (const f of facts) {
    if (has(f, PKM_FLAG.aceSpec)) ace += f.qty
    if (has(f, PKM_FLAG.radiant)) radiant += f.qty
    if (has(f, PKM_FLAG.basic)) basic = true
  }
  if (ace > 1)
    out.push({
      key: 'ace',
      severity: 'error',
      message: `${ace} ACE SPEC cards: at most 1 in a deck`
    })
  if (radiant > 1)
    out.push({
      key: 'radiant',
      severity: 'error',
      message: `${radiant} Radiant Pokémon: at most 1 in a deck`
    })
  if (!basic)
    out.push({
      key: 'basic',
      severity: 'error',
      message: 'The deck needs at least one Basic Pokémon'
    })

  for (const f of facts) {
    if (!f.card) continue
    const legal = f.keys.some((k) => (pack.keys[k].l & legalBit) !== 0)
    if (!legal) {
      out.push({
        key: `legal:${f.id}`,
        severity: 'error',
        cardId: f.id,
        message: `${f.card.name} isn't legal in ${format.label}`
      })
    }
  }
  for (const f of facts) {
    if (!f.card || f.keys.length === 0 || !f.keys.every((k) => banned.has(k))) continue
    out.push({
      key: `banned:${f.id}`,
      severity: 'error',
      cardId: f.id,
      message: `${f.card.name} is banned in ${format.label}`
    })
  }
  for (const f of facts) {
    if (!f.card || !f.unsure) continue
    out.push({
      key: `unsure:${f.id}`,
      severity: 'warning',
      cardId: f.id,
      message: `${f.card.name}: several English cards share this name; pin an English printing to check exactly`
    })
  }
  return out
}
