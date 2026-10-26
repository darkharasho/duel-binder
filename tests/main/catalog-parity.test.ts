import { describe, expect, it } from 'vitest'
import { missingPkeys } from '../../scripts/catalog/parity'
import { seededDb } from './helpers'

type Page = { pkeys: string[]; more: boolean }

describe('catalog parity', () => {
  it('reports local pkeys the server lacks', async () => {
    const db = await seededDb()
    for (const n of [1, 2, 3, 4, 5])
      db.prepare(
        `INSERT INTO card_printings (card_id, set_name, set_code, set_rarity, language)
         SELECT card_id, set_name, 'PAR-00' || ?, set_rarity, language FROM card_printings LIMIT 1`
      ).run(n)
    const local = (db.prepare('SELECT pkey FROM card_printings').all() as { pkey: string }[])
      .map((r) => r.pkey)
      .sort()
    expect(local.length).toBeGreaterThan(6)

    const lacking = [local[1], local[local.length - 1]]
    const onServer = [...local.filter((k) => !lacking.includes(k)), 'en|0|contributed|X-1|Common']
    onServer.sort()
    const mid = Math.floor(onServer.length / 2)
    const afters: (string | null)[] = []
    const fetchPage = async (after: string | null): Promise<Page> => {
      afters.push(after)
      return after === null
        ? { pkeys: onServer.slice(0, mid), more: true }
        : { pkeys: onServer.slice(mid), more: false }
    }

    expect((await missingPkeys(db, fetchPage)).sort()).toEqual(lacking)
    expect(afters).toEqual([null, onServer[mid - 1]])
  })

  it('reports nothing when the server holds every local pkey', async () => {
    const db = await seededDb()
    const all = (db.prepare('SELECT pkey FROM card_printings').all() as { pkey: string }[])
      .map((r) => r.pkey)
      .sort()
    expect(await missingPkeys(db, async () => ({ pkeys: all, more: false }))).toEqual([])
  })
})
