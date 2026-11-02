import type { TdSet } from './types'

/** Series ids that are an English series under another spelling: the Chinese list's "Mega", Japan's "M". */
const ALIASES: Record<string, string> = { mega: 'me', m: 'me' }

const fold = (s: string): string => s.trim().toLowerCase()

/** The first name each series id has among `sets`, by folded id. */
function namesById(sets: TdSet[]): Map<string, string> {
  const out = new Map<string, string>()
  for (const s of sets) {
    const id = s.serie?.id
    const name = s.serie?.name?.trim()
    if (id && name && !out.has(fold(id))) out.set(fold(id), name)
  }
  return out
}

/**
 * The series each of a language's sets sits under on the Sets page ("Scarlet & Violet"), in set
 * order. TCGdex's own name for it in the set's language comes first, then the name another set of
 * the language gives the same series (a set built from TCGplayer carries only an id), then the
 * English series of that id or name (the Chinese list names its series in English). Null when
 * none says.
 */
export function setSeries(sets: TdSet[], english: TdSet[]): (string | null)[] {
  const local = namesById(sets)
  const englishById = namesById(english)
  const englishByName = new Map([...englishById.values()].map((n) => [fold(n), n]))
  return sets.map((s) => {
    const own = s.serie?.name?.trim()
    if (own) return own
    const id = s.serie?.id ? fold(s.serie.id) : ''
    if (!id) return null
    return (
      local.get(id) ??
      englishById.get(id) ??
      englishById.get(ALIASES[id] ?? '') ??
      englishByName.get(id) ??
      null
    )
  })
}
