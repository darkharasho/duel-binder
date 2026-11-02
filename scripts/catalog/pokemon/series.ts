import type { PkmLang, TdSet } from './types'

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
 * The English series each of a language's sets sits under on the Sets page ("Scarlet & Violet"),
 * in set order, so a series is one group whatever the language, as set names are English. An
 * English set takes TCGdex's own name. Any other set takes the series of the English set with its
 * id (TCGdex's European sets share English ids), else the English series of its series id, alias
 * or name (Japan's "SV", the Chinese list's "Scarlet & Violet"). A set built with only an id
 * (from TCGplayer, a Dex export) resolves the same way. Null when nothing matches.
 */
export function setSeries(lang: PkmLang, sets: TdSet[], english: TdSet[]): (string | null)[] {
  const byId = namesById(english)
  const byName = new Map([...byId.values()].map((n) => [fold(n), n]))
  const ofSerie = (id: string | undefined): string | null => {
    if (!id) return null
    const k = fold(id)
    return byId.get(k) ?? byId.get(ALIASES[k] ?? '') ?? byName.get(k) ?? null
  }
  const twins = new Map(english.map((s) => [s.id, s]))
  return sets.map((s) => {
    const own = lang === 'en' ? s.serie?.name?.trim() : undefined
    if (own) return own
    const twin = lang === 'en' ? undefined : twins.get(s.id)
    return twin?.serie?.name?.trim() || ofSerie(twin?.serie?.id) || ofSerie(s.serie?.id)
  })
}
