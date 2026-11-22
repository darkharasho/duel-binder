import type Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CloudClient } from '../../src/main/cloud/client'
import { pullSearchTerms } from '../../src/main/cloud/localSync'
import { gameCursor } from '../../src/main/cloud/localSync'
import { matchTerms } from '../../src/main/repo/searchTerms'
import { LOCAL } from '../../src/main/repo/scope'
import type { TermFeed, WireTerm } from '../../src/shared/search/terms'
import { seededDb } from './helpers'

let db: Database.Database
beforeEach(async () => {
  db = await seededDb()
})
afterEach(() => db.close())

const term = (id: number, phrase: string, seq: number): WireTerm => ({
  id,
  game: 'ygo',
  phrase,
  phraseKey: phrase,
  kind: 'nickname',
  targetKind: 'card',
  target: { cardIds: [id] },
  seq
})
const client = (
  pages: TermFeed[]
): { client: Pick<CloudClient, 'searchTerms'>; ask: ReturnType<typeof vi.fn> } => {
  const queue = [...pages]
  const ask = vi.fn<(since: number, game: string) => Promise<TermFeed>>(async () => queue.shift()!)
  return { client: { searchTerms: ask }, ask }
}
const rows = (): { id: number; phrase_key: string; status: string }[] =>
  db.prepare('SELECT id, phrase_key, status FROM search_terms ORDER BY id').all() as never

describe('pullSearchTerms', () => {
  it('applies pages in order and saves the cursor', async () => {
    const { client: c, ask } = client([
      { terms: [term(1, 'bubble mew', 3)], deleted: [], cursor: 3, more: true },
      { terms: [term(2, 'blue eyes', 7)], deleted: [], cursor: 7, more: false }
    ])
    await expect(pullSearchTerms(db, c, 0, 'ygo')).resolves.toBe(2)
    expect(ask.mock.calls).toEqual([
      [0, 'ygo'],
      [3, 'ygo']
    ])
    expect(rows()).toEqual([
      { id: 1, phrase_key: 'bubble mew', status: 'approved' },
      { id: 2, phrase_key: 'blue eyes', status: 'approved' }
    ])
    expect(gameCursor(db, 0, 'ygo', 'terms')).toBe(7)
    expect(matchTerms(db, LOCAL, 'bubble mew').matches).toHaveLength(1)
  })

  it('removes deleted ids so the phrase stops matching, ignoring unknown ids', async () => {
    await pullSearchTerms(
      db,
      client([{ terms: [term(1, 'bubble mew', 3)], deleted: [], cursor: 3, more: false }]).client,
      0,
      'ygo'
    )
    expect(matchTerms(db, LOCAL, 'bubble mew').matches).toHaveLength(1)
    const n = await pullSearchTerms(
      db,
      client([{ terms: [], deleted: [1, 99], cursor: 5, more: false }]).client,
      0,
      'ygo'
    )
    expect(n).toBe(1)
    expect(rows()).toEqual([])
    expect(matchTerms(db, LOCAL, 'bubble mew').matches).toHaveLength(0)
    const none = await pullSearchTerms(
      db,
      client([{ terms: [], deleted: [99], cursor: 6, more: false }]).client,
      0,
      'ygo'
    )
    expect(none).toBe(0)
  })

  it('replaces an edited phrase, and survives a re-added phrase under a new id', async () => {
    await pullSearchTerms(
      db,
      client([{ terms: [term(1, 'bubble mew', 3)], deleted: [], cursor: 3, more: false }]).client,
      0,
      'ygo'
    )
    // edited: same id, new phrase
    await pullSearchTerms(
      db,
      client([{ terms: [term(1, 'bubble mewtwo', 4)], deleted: [], cursor: 4, more: false }])
        .client,
      0,
      'ygo'
    )
    expect(rows().map((r) => r.phrase_key)).toEqual(['bubble mewtwo'])
    expect(matchTerms(db, LOCAL, 'bubble mew').matches).toHaveLength(0)
    // re-added: same phrase held by another id, whose deletion may not be in the feed
    await pullSearchTerms(
      db,
      client([{ terms: [term(5, 'bubble mewtwo', 9)], deleted: [], cursor: 9, more: false }])
        .client,
      0,
      'ygo'
    )
    expect(rows()).toEqual([{ id: 5, phrase_key: 'bubble mewtwo', status: 'approved' }])
    // deleted applies before terms within a page
    await pullSearchTerms(
      db,
      client([{ terms: [term(5, 'bubble mewtwo', 10)], deleted: [5], cursor: 10, more: false }])
        .client,
      0,
      'ygo'
    )
    expect(rows()).toEqual([{ id: 5, phrase_key: 'bubble mewtwo', status: 'approved' }])
  })
})
