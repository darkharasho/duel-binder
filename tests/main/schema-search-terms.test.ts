import Database from 'better-sqlite3'
import { migrate } from '../../src/main/db/database'

describe('search_terms (V52)', () => {
  it('stores a row and exposes the cards_fts vocab table', () => {
    const db = new Database(':memory:')
    migrate(db)
    db.prepare(
      `INSERT INTO search_terms (game, phrase, phrase_key, kind, target_kind, target, source, created_at)
       VALUES ('ygo', 'Blue Eyes', 'blue eyes', 'alias', 'card', '{}', 'seed', 't')`
    ).run()
    expect(db.prepare('SELECT status, evidence, seq FROM search_terms').get()).toEqual({
      status: 'pending',
      evidence: '{}',
      seq: 0
    })
    expect(() => db.prepare('SELECT term FROM cards_fts_vocab LIMIT 1').all()).not.toThrow()
    db.close()
  })
})
