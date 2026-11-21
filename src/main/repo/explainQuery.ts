import type { SqlDb } from '../db/sql'
import type { SearchTerm, TermNote } from '../../shared/search/terms'
import { matchTerms, termPrintingIds } from './searchTerms'
import type { Scope } from './scope'

/** The printing's card name, set and number, e.g. "Mew ex · Paldean Fates 232/91". */
function printingLabel(db: SqlDb, scope: Scope, printingId: number): string | null {
  const r = db
    .prepare(
      `SELECT c.name, p.set_name, p.set_code FROM card_printings p
       JOIN cards c ON c.id = p.card_id AND +c.game = ${scope.game}
       WHERE p.id = ? AND +p.game = ${scope.game}`
    )
    .get(printingId) as { name: string; set_name: string; set_code: string } | undefined
  return r ? `${r.name} · ${r.set_name} ${r.set_code}`.trim() : null
}

/** Cards of `ids` that exist locally, in `ids` order. */
function localCards(db: SqlDb, scope: Scope, ids: number[]): { id: number; name: string }[] {
  if (ids.length === 0) return []
  const rows = db
    .prepare(
      `SELECT id, name FROM cards WHERE id IN (SELECT value FROM json_each(?)) AND +game = ${scope.game}`
    )
    .all(JSON.stringify(ids)) as { id: number; name: string }[]
  const byId = new Map(rows.map((r) => [r.id, r]))
  return ids.flatMap((id) => byId.get(id) ?? [])
}

export function labelOf(db: SqlDb, scope: Scope, term: SearchTerm): string | null {
  const t = term.target
  switch (term.targetKind) {
    case 'printing': {
      const [id] = termPrintingIds(db, scope, t, 1)
      return id === undefined ? null : printingLabel(db, scope, id)
    }
    case 'card':
    case 'cards': {
      const cards = localCards(db, scope, t.cardIds ?? [])
      if (cards.length === 0) return null
      return cards.length === 1 ? cards[0].name : `${cards.length} cards`
    }
    case 'set': {
      const found = (t.sets ?? []).filter(
        (s) =>
          db
            .prepare(
              `SELECT 1 FROM sets WHERE +game = ${scope.game} AND language = ? AND set_name = ?`
            )
            .get(s.language, s.setName) !== undefined
      )
      if (found.length === 0) return null
      return found.length === 1 ? found[0].setName : `${found[0].setName} +${found.length - 1} more`
    }
    case 'rarity':
      return termPrintingIds(db, scope, t, 1).length === 0 ? null : (t.rarities ?? []).join(', ')
    default:
      return null
  }
}

/** One note per community term in `text` whose target exists locally. */
export function explainQuery(db: SqlDb, scope: Scope, text: string): TermNote[] {
  const notes: TermNote[] = []
  for (const { term } of matchTerms(db, scope, text).matches) {
    const label = labelOf(db, scope, term)
    if (label) notes.push({ phrase: term.phrase, label })
  }
  return notes
}
