import type { GameId } from '../../src/shared/games/types'
import { termKey, termWords } from '../../src/shared/search/terms'

export interface HarvestedPrinting {
  game: GameId
  pkey: string
  cardId: number
  name: string
  setName: string
  setCode: string
  number: string
  rarity: string
  language: string
  titles: { title: string; seller: string }[]
}

export interface Candidate {
  id: string
  game: GameId
  phrase: string
  scope: 'printing' | 'set' | 'global'
  count: number
  sellers: number
  pkeys: string[]
  sets: { language: string; setName: string }[]
  cardIds: number[]
  rarities: string[]
  sampleTitles: string[]
}

export const STOP_WORDS: ReadonlySet<string> = new Set([
  // grading
  'psa', 'bgs', 'cgc', 'tag', 'ace', 'sgc', 'beckett', 'gem', 'mint', 'pristine',
  '1', '2', '3', '4', '5', '6', '7', '8', '9', '10',
  // condition
  'nm', 'lp', 'mp', 'hp', 'near', 'played',
  // selling
  'free', 'ship', 'shipping', 'fast', 'lot', 'bundle', 'new', 'sealed', 'pack', 'fresh',
  // finish
  'holo', 'foil',
  // languages
  'english', 'japanese', 'korean', 'chinese', 'french', 'german', 'italian', 'spanish', 'portuguese', 'russian',
  'en', 'jp', 'jpn', 'ja', 'kr', 'ko', 'zh', 'fr', 'de', 'it', 'es', 'pt', 'ru',
  // game names
  'pokemon', 'yugioh', 'yu', 'gi', 'oh', 'magic', 'gathering', 'mtg', 'one', 'piece',
  // generic
  'card', 'tcg', 'ccg',
])

/** Words of a title that no known source explains, as runs split wherever a word was removed. */
export function leftoverWords(p: HarvestedPrinting, title: string, known: ReadonlySet<string>): string[][] {
  const own = new Set([p.name, p.setName, p.setCode, p.number, p.rarity].flatMap(termWords))
  const runs: string[][] = []
  let run: string[] = []
  for (const w of termWords(title)) {
    if (own.has(w) || STOP_WORDS.has(w) || known.has(w)) {
      if (run.length) runs.push(run)
      run = []
    } else run.push(w)
  }
  if (run.length) runs.push(run)
  return runs
}

interface Acc {
  titles: Set<string>
  sellers: Set<string>
  samples: Set<string>
  perPkey: Map<string, number>
  sets: Map<string, { language: string; setName: string }>
  setOfPkey: Map<string, string>
  cardIds: Set<number>
  rarities: Set<string>
}

function ngrams(runs: string[][]): Set<string> {
  const out = new Set<string>()
  for (const run of runs)
    for (let i = 0; i < run.length; i++)
      for (let n = 1; n <= 3 && i + n <= run.length; n++) out.add(run.slice(i, i + n).join(' '))
  return out
}

export function findCandidates(
  harvest: HarvestedPrinting[],
  knownKeys: ReadonlySet<string>,
  opts = { minCount: 4, minSellers: 3 },
): Candidate[] {
  const knownWords = new Set([...knownKeys].filter((k) => !k.includes(' ')))
  const byGame = new Map<GameId, Map<string, Acc>>()
  harvest.forEach((p, pi) => {
    let accs = byGame.get(p.game)
    if (!accs) byGame.set(p.game, (accs = new Map()))
    const setKey = `${p.language}\u0000${p.setName}`
    p.titles.forEach((t, ti) => {
      for (const phrase of ngrams(leftoverWords(p, t.title, knownWords))) {
        let a = accs.get(phrase)
        if (!a) {
          a = {
            titles: new Set(), sellers: new Set(), samples: new Set(), perPkey: new Map(),
            sets: new Map(), setOfPkey: new Map(), cardIds: new Set(), rarities: new Set(),
          }
          accs.set(phrase, a)
        }
        a.titles.add(`${pi}:${ti}`)
        if (t.seller) a.sellers.add(t.seller)
        if (a.samples.size < 5) a.samples.add(t.title)
        a.perPkey.set(p.pkey, (a.perPkey.get(p.pkey) ?? 0) + 1)
        a.sets.set(setKey, { language: p.language, setName: p.setName })
        a.setOfPkey.set(p.pkey, setKey)
        a.cardIds.add(p.cardId)
        a.rarities.add(p.rarity)
      }
    })
  })

  const out: Candidate[] = []
  for (const [game, accs] of byGame) {
    const kept: Candidate[] = []
    for (const [phrase, a] of accs) {
      const count = a.titles.size
      if (count < opts.minCount || a.sellers.size < opts.minSellers) continue
      if (phrase.split(' ').every((w) => /^\d+$/.test(w))) continue
      if (knownKeys.has(termKey(phrase))) continue
      const pkeys = [...a.perPkey.keys()]
      let scope: Candidate['scope']
      if (Math.max(...a.perPkey.values()) >= 0.6 * count) scope = 'printing'
      else if (pkeys.length >= 3 && a.sets.size === 1) scope = 'set'
      else if (a.sets.size >= 3) scope = 'global'
      else continue
      kept.push({
        id: `${game}:${termKey(phrase)}`,
        game,
        phrase,
        scope,
        count,
        sellers: a.sellers.size,
        pkeys,
        sets: [...a.sets.values()],
        cardIds: [...a.cardIds],
        rarities: [...a.rarities],
        sampleTitles: [...a.samples],
      })
    }
    // A phrase is redundant when a longer one containing it covers at least 80% of its titles.
    const padded = kept.map((c) => ` ${c.phrase} `)
    out.push(
      ...kept.filter(
        (c, i) => !kept.some((o, j) => j !== i && o.phrase.length > c.phrase.length && padded[j].includes(padded[i]) && o.count >= 0.8 * c.count),
      ),
    )
  }
  return out.sort((a, b) => b.sellers - a.sellers || b.count - a.count)
}
