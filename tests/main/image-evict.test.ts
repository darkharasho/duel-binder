import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createEvictionScheduler,
  evictImages,
  ownedImageKeys,
  runEviction
} from '../../src/main/images/evict'
import { seededDb } from './helpers'
import { seedMagic } from '../fixtures/magic'

let dir: string
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'evict-'))
})
afterEach(async () => {
  vi.useRealTimers()
  await fs.rm(dir, { recursive: true, force: true })
})

/** Writes `bytes` bytes at `rel`, last used `ageDays` ago. */
async function put(rel: string, bytes: number, ageDays: number): Promise<void> {
  const file = path.join(dir, rel)
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, Buffer.alloc(bytes))
  const t = new Date(Date.now() - ageDays * 86_400_000)
  await fs.utimes(file, t, t)
}
const has = (rel: string): Promise<boolean> =>
  fs.stat(path.join(dir, rel)).then(
    () => true,
    () => false
  )

describe('evictImages', () => {
  it('keeps owned files and trims the rest oldest first to the target', async () => {
    await put('full/1.jpg', 100, 30) // owned, the oldest of all
    await put('full/2.jpg', 100, 20)
    await put('small/3.jpg', 100, 10)
    await put('sets/abc.jpg', 100, 5)
    await put('printings/tp-x.png', 100, 1)

    const r = await evictImages({
      dir,
      keep: new Set(['full/1']),
      busy: new Set(),
      budget: 350,
      target: 250
    })

    expect(r).toEqual({ deleted: 2, freed: 200 })
    expect(await has('full/1.jpg')).toBe(true)
    expect(await has('full/2.jpg')).toBe(false)
    expect(await has('small/3.jpg')).toBe(false)
    expect(await has('sets/abc.jpg')).toBe(true)
    expect(await has('printings/tp-x.png')).toBe(true)
  })

  it('does nothing under budget', async () => {
    await put('full/2.jpg', 100, 20)
    await put('small/3.jpg', 100, 10)
    const r = await evictImages({ dir, keep: new Set(), busy: new Set(), budget: 200, target: 100 })
    expect(r).toEqual({ deleted: 0, freed: 0 })
    expect(await has('full/2.jpg')).toBe(true)
  })

  it("deletes an image's .brief and .none markers with it", async () => {
    await put('full/2.jpg', 100, 20)
    await put('full/2.jpg.brief', 0, 20)
    await put('printings-small/tp-y.jpg', 100, 19)
    await put('printings-small/tp-y.none', 0, 19)
    await put('small/9.jpg', 100, 1)
    await evictImages({ dir, keep: new Set(), busy: new Set(), budget: 150, target: 100 })
    expect(await has('full/2.jpg')).toBe(false)
    expect(await has('full/2.jpg.brief')).toBe(false)
    expect(await has('printings-small/tp-y.jpg')).toBe(false)
    expect(await has('printings-small/tp-y.none')).toBe(false)
    expect(await has('small/9.jpg')).toBe(true)
  })

  it('leaves tmp and in-flight files alone', async () => {
    await put('full/2.jpg', 100, 20)
    await put('full/3.jpg.tmp', 100, 20)
    await put('small/4.jpg', 100, 19)
    await put('small/5.jpg', 100, 1)
    const r = await evictImages({
      dir,
      keep: new Set(),
      busy: new Set(['full/2']),
      budget: 250,
      target: 100
    })
    expect(await has('full/2.jpg')).toBe(true)
    expect(await has('full/3.jpg.tmp')).toBe(true)
    expect(await has('small/4.jpg')).toBe(false)
    expect(r.deleted).toBe(2)
  })
})

describe('ownedImageKeys', () => {
  it('lists art by image_id and printing photo keys for live entries only', async () => {
    const db = await seededDb()
    const [a, b] = db
      .prepare(
        `SELECT p.id AS printing, i.image_id AS image FROM card_printings p
         JOIN card_images i ON i.card_id = p.card_id GROUP BY p.card_id ORDER BY p.id LIMIT 2`
      )
      .all() as { printing: number; image: number }[]
    const add = db.prepare(
      `INSERT INTO collection_entries (uid, printing_id, image_id, quantity, notes, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, 1, '', 'x', 'x', ?)`
    )
    add.run('live', a.printing, a.image, null)
    add.run('gone', b.printing, b.image, 'x')

    const keys = await ownedImageKeys(db, async (id) => (id === a.printing ? 'tp-own' : null))

    expect([...keys].sort()).toEqual(
      [
        `small/${a.image}`,
        `full/${a.image}`,
        `cropped/${a.image}`,
        'printings/tp-own',
        'printings-small/tp-own'
      ].sort()
    )
  })
})

describe('ownedImageKeys: art an owned card shows that is not its own', () => {
  it("keeps a Pokémon twin's art and a Magic card's back face", async () => {
    const db = await seededDb()
    const { printingIds, imageIds } = seedMagic(db)
    db.prepare('UPDATE mtg_images SET back_image_id = 777001 WHERE image_id = ?').run(imageIds[0])
    const card = db.prepare(
      `INSERT INTO cards (id, game, name, type, frame_type, race, "desc", updated_at)
       VALUES (?, 'pkm', ?, 'Pokemon', 'pkm', '', '', 'x')`
    )
    const image = db.prepare(
      "INSERT INTO card_images (image_id, game, card_id, sort_order) VALUES (?, 'pkm', ?, 0)"
    )
    const pkm = db.prepare(
      `INSERT INTO pokemon_cards (card_id, category, source_id, art_twin_id, traditional_twin_id)
       VALUES (?, 'Pokemon', ?, ?, ?)`
    )
    card.run(801, 'English Twin')
    card.run(802, 'Traditional Twin')
    card.run(803, 'Owned Chinese Card')
    for (const id of [801, 802, 803]) image.run(id * 10, id)
    pkm.run(801, 'en/1', null, null)
    pkm.run(802, 'zh-hant/1', null, null)
    pkm.run(803, 'zh-hans/1', 801, 802)
    db.prepare(
      `INSERT INTO card_printings (game, card_id, language, set_name, set_code, set_rarity)
       VALUES ('pkm', 803, 'zh-hans', 'Set', 'S1', 'Common')`
    ).run()
    const pkmPrinting = (
      db.prepare('SELECT id FROM card_printings WHERE card_id = 803').get() as { id: number }
    ).id
    const add = db.prepare(
      `INSERT INTO collection_entries (uid, printing_id, image_id, quantity, notes, created_at, updated_at)
       VALUES (?, ?, ?, 1, '', 'x', 'x')`
    )
    add.run('mtg', printingIds[0], imageIds[0])
    add.run('pkm', pkmPrinting, 8030)

    const keys = await ownedImageKeys(db, async () => null)

    for (const id of [777001, 8010, 8020, 8030, imageIds[0]])
      for (const d of ['small', 'full', 'cropped'])
        expect(keys, `${d}/${id}`).toContain(`${d}/${id}`)
  })
})

describe('runEviction', () => {
  it("skips eviction when owned keys can't be read", async () => {
    await put('full/2.jpg', 100, 20)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const r = await runEviction({
      dir,
      owned: async () => {
        throw new Error('database is locked')
      },
      busy: () => new Set(),
      budget: 10,
      target: 5
    })
    expect(r).toBeNull()
    expect(await has('full/2.jpg')).toBe(true)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('createEvictionScheduler', () => {
  it('runs once after the first delay, then after every so many bytes, one at a time', async () => {
    vi.useFakeTimers()
    let release: () => void = () => {}
    const run = vi.fn(
      () =>
        new Promise<void>((r) => {
          release = r
        })
    )
    const s = createEvictionScheduler({ run, firstAfterMs: 1000, everyBytes: 100 })

    s.downloaded(150) // before the first run: counted, but the first run waits for its timer
    expect(run).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1000)
    expect(run).toHaveBeenCalledTimes(1)

    s.downloaded(150) // a run is under way: not another at once, but the bytes count
    expect(run).toHaveBeenCalledTimes(1)
    release()
    await vi.advanceTimersByTimeAsync(0)
    s.downloaded(1)
    expect(run).toHaveBeenCalledTimes(2)
    release()
    await vi.advanceTimersByTimeAsync(0)

    s.downloaded(60)
    expect(run).toHaveBeenCalledTimes(2)
    s.downloaded(60)
    expect(run).toHaveBeenCalledTimes(3)
    release()
    s.dispose()
  })
})
