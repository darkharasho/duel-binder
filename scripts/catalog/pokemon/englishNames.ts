import { hasNativeScript } from '../../../src/shared/setNames'
import type { TdCard } from './types'

/**
 * English names for Japanese cards no TCGplayer product names (spec: English is the app's
 * language). Display data only: a card's id, its printings' keys and its prices never depend on
 * its name. Tried in order:
 *  1. "pair": the English name the catalog already gives other Japanese cards with the same
 *     Japanese name (their TCGplayer product's), when most of them agree;
 *  2. "species": for a Pokémon, its English species name by National Pokédex number (TCGdex's
 *     `dexId`, named from TCGdex's English cards), with the Japanese name's known prefixes
 *     ("ロケット団の", "アローラ", …) and suffixes ("ex", "GX", "（デルタ種）", …) carried over;
 *  3. "energy": an Energy named by its type ("基本水エネルギー" → "Basic Water Energy").
 * Else the card keeps TCGdex's Japanese name.
 */

export type NamedBy = 'pair' | 'species' | 'energy'

export interface EnglishNamer {
  /** The English name of a Japanese card, or null when none can be found. */
  nameOf(card: TdCard): { name: string; by: NamedBy } | null
}

/** NFKC folds full-width letters and brackets ("ＧＸ", "（") to their plain forms. */
const fold = (s: string): string => s.normalize('NFKC').trim()

/** The English name's own suffixes and prefixes, stripped to find a species' base name. */
const EN_SUFFIX =
  /(?:[ -](?:ex|EX|GX|V|VMAX|VSTAR|V-UNION|LV\.X|BREAK|Prime|LEGEND|δ|☆|Star|Prism Star|◇)|\s+Lv\.\s?\d+|\s+\([^)]*\))$/
const EN_PREFIX =
  /^(?:Dark|Light|Shining|Radiant|M|Mega|Alolan|Galarian|Hisuian|Paldean|Team Rocket's|Team Aqua's|Team Magma's|Holon's|[A-Z][\w.-]*(?: [A-Z][\w.-]*)?'s) /

function baseEnglish(name: string): string {
  let n = fold(name)
  for (let prev = ''; prev !== n;) {
    prev = n
    n = n.replace(EN_SUFFIX, '').replace(EN_PREFIX, '').trim()
  }
  return n
}

/** Japanese suffixes, longest first, and what each adds to the English name. */
const JA_SUFFIXES: readonly [string, string][] = [
  ['プリズムスター', ' Prism Star'],
  ['(デルタ種)', ' δ'],
  ['V-UNION', ' V-UNION'],
  ['VUNION', ' V-UNION'],
  ['VSTAR', ' VSTAR'],
  ['VMAX', ' VMAX'],
  ['BREAK', ' BREAK'],
  ['LV.X', ' LV.X'],
  ['エクス', ' ex'],
  ['GX', ' GX'],
  ['EX', ' EX'],
  ['ex', ' ex'],
  ['Ex', ' ex'],
  ['V', ' V'],
  ['δ', ' δ'],
  ['☆', ' ☆'],
  ['◇', ' Prism Star']
]

/** Japanese prefixes and what each puts before the English name. */
const JA_PREFIXES: readonly [string, string][] = [
  ['ロケット団の', "Team Rocket's "],
  ['マグマ団の', "Team Magma's "],
  ['アクア団の', "Team Aqua's "],
  ['ホロンの', "Holon's "],
  ['かがやく', 'Radiant '],
  ['輝く', 'Shining '],
  ['ひかる', 'Shining '],
  ['わるい', 'Dark '],
  ['やさしい', 'Light '],
  ['ダーク', 'Dark '],
  ['暗い', 'Dark '],
  ['アローラ', 'Alolan '],
  ['ガラル', 'Galarian '],
  ['ヒスイ', 'Hisuian '],
  ['パルデア', 'Paldean '],
  ['メガ', 'Mega '],
  ['M', 'M ']
]

const LATIN_END = /[A-Za-z]$/
const LATIN_START = /^[A-Za-z]/

const ENERGY_TYPES: Readonly<Record<string, string>> = {
  草: 'Grass',
  炎: 'Fire',
  水: 'Water',
  雷: 'Lightning',
  超: 'Psychic',
  闘: 'Fighting',
  悪: 'Darkness',
  鋼: 'Metal',
  金属: 'Metal',
  フェアリー: 'Fairy',
  ドラゴン: 'Dragon'
}
const BASIC_ENERGY = /^(基本)?\s*(草|炎|水|雷|超|闘|悪|鋼|金属|フェアリー|ドラゴン)\s*エネルギー$/

/** The most common of `counts`, ties to the shortest then the first in code-point order. */
function mostCommon(counts: Map<string, number>): string | null {
  let best: string | null = null
  let top = 0
  for (const [k, n] of counts) {
    if (
      best === null ||
      n > top ||
      (n === top && (k.length < best.length || (k.length === best.length && k < best)))
    ) {
      best = k
      top = n
    }
  }
  return best
}

/** The value more than half of `counts` agree on, else null. */
function majority(counts: Map<string, number>): string | null {
  let total = 0
  for (const n of counts.values()) total += n
  const best = mostCommon(counts)
  return best !== null && counts.get(best)! * 2 > total ? best : null
}

function bump<K>(m: Map<K, Map<string, number>>, k: K, v: string): void {
  let c = m.get(k)
  if (!c) m.set(k, (c = new Map()))
  c.set(v, (c.get(v) ?? 0) + 1)
}

/** A TCGplayer product name as a card name: no " - {number} …" tail and no " (Lv.12)" note. */
const cleanProductName = (name: string): string =>
  fold(name)
    .replace(/\s+-\s+.*$/, '')
    .replace(/\s+\([^)]*\)$/, '')
    .trim()

/**
 * A namer from TCGdex's English cards (for species names) and the Japanese cards already named
 * from a product (`named`: their Japanese and English names).
 */
export function englishNamer(
  enCards: Iterable<TdCard>,
  jaCards: Iterable<TdCard>,
  named: Iterable<{ japanese: string; english: string }>
): EnglishNamer {
  const enCounts = new Map<number, Map<string, number>>()
  for (const c of enCards) {
    if (c.category !== 'Pokemon' || c.dexId?.length !== 1) continue
    const base = baseEnglish(c.name)
    if (base) bump(enCounts, c.dexId[0], base)
  }
  const species = new Map<number, string>()
  for (const [dex, counts] of enCounts) {
    const n = mostCommon(counts)
    if (n) species.set(dex, n)
  }

  // A species' own Japanese names, never cut into prefix or suffix: "ダークライ" is Darkrai, not
  // "ダーク" + "ライ"; "ブースター" is Flareon, not "ブー" + "スター". They are its usual name among
  // TCGdex's Japanese cards (only one several cards share: a lone "クヌギダマex" says nothing),
  // and the Japanese names of cards a product names exactly as the species (added below).
  const jaCounts = new Map<number, Map<string, number>>()
  for (const c of jaCards) {
    if (c.category === 'Pokemon' && c.dexId?.length === 1) bump(jaCounts, c.dexId[0], fold(c.name))
  }
  const ownNames = new Map<string, Set<string>>()
  const addOwn = (en: string, ja: string): void => {
    let set = ownNames.get(en)
    if (!set) ownNames.set(en, (set = new Set()))
    set.add(ja)
  }
  for (const [dex, counts] of jaCounts) {
    const n = mostCommon(counts)
    const en = species.get(dex)
    if (n && en && counts.get(n)! >= 2) addOwn(en, n)
  }

  const pairCounts = new Map<string, Map<string, number>>()
  const ownerCounts = new Map<string, Map<string, number>>()
  for (const { japanese, english } of named) {
    const en = cleanProductName(english)
    if (!en || hasNativeScript(en)) continue
    const ja = fold(japanese)
    bump(pairCounts, ja, en)
    const jo = /^(.+?)の./.exec(ja)
    const eo = /^(.+?)'s ./.exec(en)
    if (jo && eo) bump(ownerCounts, jo[1], eo[1])
  }
  const pairs = new Map<string, string>()
  for (const [ja, counts] of pairCounts) {
    const en = majority(counts)
    if (en) pairs.set(ja, en)
  }
  const speciesNames = new Set(species.values())
  for (const [ja, en] of pairs) if (speciesNames.has(en)) addOwn(en, ja)
  const owners = new Map<string, string>()
  for (const [ja, counts] of ownerCounts) {
    const en = majority(counts)
    if (en) owners.set(ja, en)
  }

  const speciesName = (card: TdCard): string | null => {
    const dex = card.dexId ?? []
    if (card.category !== 'Pokemon' || dex.length === 0) return null
    const names = dex.map((d) => species.get(d))
    if (names.some((n) => !n)) return null
    const own = dex.length === 1 ? ownNames.get(names[0]!) : undefined
    const isOwn = (n: string): boolean => own?.has(n) ?? false
    const startsOwn = (n: string): boolean => [...(own ?? [])].some((o) => n.startsWith(o))
    let rest = fold(card.name)
    let suffix = ''
    for (let found = true; found && !isOwn(rest);) {
      found = false
      for (const [ja, en] of JA_SUFFIXES) {
        if (rest.length > ja.length && rest.endsWith(ja)) {
          rest = rest.slice(0, -ja.length).trim()
          suffix = en + suffix
          found = true
          break
        }
      }
    }
    let prefix = ''
    if (dex.length === 1) {
      for (let found = true; found && !startsOwn(rest);) {
        found = false
        for (const [ja, en] of JA_PREFIXES) {
          const after = rest.slice(ja.length)
          // A Latin prefix ("M") only before a non-Latin name: "Magcargo" is not "M" + "agcargo".
          if (after && rest.startsWith(ja) && !(LATIN_END.test(ja) && LATIN_START.test(after))) {
            rest = after.trim()
            prefix += en
            found = true
            break
          }
        }
        const o = found ? null : /^(.+?)の./.exec(rest)
        if (o) {
          // An owner ("ナンジャモの"): in English when other cards name it, else left out.
          const who = owners.get(o[1])
          if (who) prefix += `${who}'s `
          rest = rest.slice(o[1].length + 1)
          found = true
        }
      }
    }
    return `${prefix}${names.join(' & ')}${suffix}`
  }

  return {
    nameOf(card) {
      const ja = fold(card.name)
      if (!hasNativeScript(ja)) return null
      const pair = pairs.get(ja)
      if (pair) return { name: pair, by: 'pair' }
      const sp = speciesName(card)
      if (sp) return { name: sp, by: 'species' }
      const energy = BASIC_ENERGY.exec(ja)
      if (energy) {
        const type = ENERGY_TYPES[energy[2]]
        return { name: energy[1] ? `Basic ${type} Energy` : `${type} Energy`, by: 'energy' }
      }
      return null
    }
  }
}
