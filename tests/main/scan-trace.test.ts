import { describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createScanTrace, describeArt } from '../../src/main/scan/scanTrace'
import { seededDb } from './helpers'

const S1 = '2026-11-13T01-00-00-000Z'
const jpeg = (): ArrayBuffer => new Uint8Array([0xff, 0xd8, 1, 2]).buffer

function lines(root: string, session: string): Record<string, unknown>[] {
  return readFileSync(join(root, session, 'trace.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l) as Record<string, unknown>)
}

describe('scan trace writer', () => {
  it('writes lines and numbered frames', async () => {
    const root = mkdtempSync(join(tmpdir(), 'trace-'))
    const w = createScanTrace({ root })
    await expect(w.write(S1, { seq: 1 })).resolves.toBeNull()
    await expect(w.write(S1, { seq: 2 }, jpeg())).resolves.toBe('0000.jpg')
    const ls = lines(root, S1)
    expect(ls).toHaveLength(2)
    expect(ls[0]).toEqual({ seq: 1 })
    expect(ls[1]).toEqual({ seq: 2, frame: '0000.jpg' })
    expect(existsSync(join(root, S1, '0000.jpg'))).toBe(true)
  })

  it('stops keeping frames past maxFrames', async () => {
    const root = mkdtempSync(join(tmpdir(), 'trace-'))
    const w = createScanTrace({ root, maxFrames: 2 })
    await w.write(S1, { seq: 1 }, jpeg())
    await w.write(S1, { seq: 2 }, jpeg())
    await expect(w.write(S1, { seq: 3 }, jpeg())).resolves.toBeNull()
    const ls = lines(root, S1)
    expect(ls).toHaveLength(3)
    expect(ls[2]).toEqual({ seq: 3 })
    expect(readdirSync(join(root, S1)).filter((f) => f.endsWith('.jpg'))).toHaveLength(2)
  })

  it('prunes the oldest sessions', async () => {
    const root = mkdtempSync(join(tmpdir(), 'trace-'))
    const w = createScanTrace({ root, maxSessions: 2 })
    for (const h of ['01', '02', '03']) await w.write(`2026-11-13T${h}-00-00-000Z`, { h })
    expect(readdirSync(root).sort()).toEqual([
      '2026-11-13T02-00-00-000Z',
      '2026-11-13T03-00-00-000Z'
    ])
  })

  it('rejects a bad session id', async () => {
    const root = mkdtempSync(join(tmpdir(), 'trace-'))
    const w = createScanTrace({ root })
    await expect(w.write('../x', {})).rejects.toThrow()
  })

  it('describeArt names images', async () => {
    const db = await seededDb()
    const row = db
      .prepare(
        `SELECT i.image_id AS imageId, c.name FROM card_images i JOIN cards c ON c.id = i.card_id
         WHERE EXISTS (SELECT 1 FROM card_printings p WHERE p.card_id = c.id) LIMIT 1`
      )
      .get() as { imageId: number; name: string }
    const out = describeArt(db, [123456789012, row.imageId])
    expect(out).toHaveLength(1)
    expect(out[0]!.imageId).toBe(row.imageId)
    expect(out[0]!.name).toBe(row.name)
    expect(out[0]!.sets.length).toBeGreaterThan(0)
    expect(out[0]!.sets.length).toBeLessThanOrEqual(3)
  })
})
