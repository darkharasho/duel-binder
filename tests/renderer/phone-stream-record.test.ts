import { beforeEach, describe, expect, it } from 'vitest'
import type { ScanRow } from '@/features/scan/session'
import {
  endStream,
  loadStream,
  newStream,
  reconcile,
  recordSaved,
  recordPull,
  saveStream,
  streamCards,
  type StreamRecord
} from '../../src/phone/stream/record'

const row = (key: string, extra: Partial<ScanRow> = {}): ScanRow => ({
  key,
  cardId: 1,
  name: 'Card',
  imageId: 10,
  printingId: 101,
  setCode: 'SET-EN001',
  rarity: 'Common',
  options: [],
  flag: null,
  via: 'code',
  quantity: 1,
  addedAt: 1,
  ...extra
})
const rec = (...rows: ScanRow[]): StreamRecord => ({ game: 'ygo', rows, saved: {} })

describe('stream record', () => {
  beforeEach(() => localStorage.clear())
  const saved = (r: StreamRecord, key: string, n: number): StreamRecord => recordSaved(r, key, n)

  it('takes a corrected printing or quantity from the list', () => {
    const out = reconcile(rec(row('k')), [row('k', { quantity: 2, rarity: 'Secret Rare' })])
    expect(out.rows.map((r) => [r.quantity, r.rarity])).toEqual([[2, 'Secret Rare']])
  })

  it('keeps a saved row after it leaves the list', () => {
    const out = reconcile(saved(rec(row('k')), 'k', 2), [])
    expect(out.rows.map((r) => [r.key, r.quantity])).toEqual([['k', 2]])
  })

  it('counts saved and unsaved copies of a partly saved row', () => {
    const out = reconcile(saved(rec(row('k')), 'k', 2), [row('k')])
    expect(out.rows[0].quantity).toBe(3)
  })

  it('takes a changed rarity for a row on the list and saved', () => {
    const out = reconcile(saved(rec(row('k')), 'k', 1), [row('k', { rarity: 'Rare' })])
    expect(out.rows.map((r) => [r.quantity, r.rarity])).toEqual([[2, 'Rare']])
  })

  it('drops a row removed from the list without saving', () => {
    expect(reconcile(rec(row('k')), []).rows).toEqual([])
  })

  it('ignores list rows that were not pulled on this stream', () => {
    const r = rec(row('k'))
    expect(reconcile(r, [row('k'), row('other')])).toBe(r)
  })

  it('returns the same record when nothing changed', () => {
    const r = rec(row('k', { quantity: 3 }))
    expect(reconcile(r, [row('k', { quantity: 3 })])).toBe(r)
    const settled = reconcile(saved(rec(row('k')), 'k', 2), [row('k')])
    expect(reconcile(settled, [row('k')])).toBe(settled)
  })

  it('ignores saves for keys not in the record', () => {
    const r = rec(row('k'))
    expect(recordSaved(r, 'other', 2)).toBe(r)
  })

  it('adds a pull, and takes the newer row for a key already there', () => {
    const a = recordPull(newStream('ygo'), row('k'))
    const b = recordPull(a, row('j'))
    expect(b.rows.map((r) => r.key)).toEqual(['j', 'k'])
    const c = recordPull(b, row('k', { quantity: 2 }))
    expect(c.rows.map((r) => [r.key, r.quantity])).toEqual([
      ['j', 1],
      ['k', 2]
    ])
    expect(streamCards(c)).toBe(3)
  })

  it('keeps saved copies across a restart, and carrying on twice changes nothing', () => {
    const r = reconcile(saved(rec(row('k')), 'k', 2), [])
    saveStream(r)
    const once = reconcile(loadStream()!, [])
    const twice = reconcile(loadStream()!, [])
    expect(once.rows.map((x) => [x.key, x.quantity])).toEqual([['k', 2]])
    expect(twice).toEqual(once)
    expect(reconcile(once, [row('k')]).rows[0].quantity).toBe(3)
  })

  it('clears storage when a stream ends', () => {
    saveStream(rec(row('k')))
    endStream()
    expect(loadStream()).toBeNull()
  })

  it('loads null from corrupt storage', () => {
    localStorage.setItem('scan.stream.v1', '{nope')
    expect(loadStream()).toBeNull()
    localStorage.setItem('scan.stream.v1', '{"game":"x","rows":[]}')
    expect(loadStream()).toBeNull()
  })

  it('tolerates garbled rows and saved on load', () => {
    localStorage.setItem(
      'scan.stream.v1',
      JSON.stringify({ game: 'pkm', rows: [row('k'), { quantity: 1 }, { key: 'x' }], saved: 7 })
    )
    expect(loadStream()).toEqual({ game: 'pkm', rows: [row('k')], saved: {} })
    localStorage.setItem(
      'scan.stream.v1',
      JSON.stringify({ game: 'ygo', rows: [], saved: { a: 2, b: 'x', c: -1 } })
    )
    expect(loadStream()?.saved).toEqual({ a: 2 })
  })
})
