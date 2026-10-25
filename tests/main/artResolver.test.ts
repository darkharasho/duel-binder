import { describe, expect, it, vi } from 'vitest'
import { createPrintingArtResolver } from '../../src/main/yugipedia/artResolver'
import type { YugipediaClient } from '../../src/main/yugipedia/client'
import { seededDb } from './helpers'

const printing = (db: Awaited<ReturnType<typeof seededDb>>, code: string): number =>
  (db.prepare('SELECT id FROM card_printings WHERE set_code = ?').get(code) as { id: number }).id

function fakeClient(files: Record<string, string[]>): YugipediaClient & {
  listPageImages: ReturnType<typeof vi.fn>
  fetchImageUrls: ReturnType<typeof vi.fn>
} {
  return {
    listSetListTitles: async () => [],
    fetchPages: async () => new Map(),
    listPageImages: vi.fn(async (titles: string[]) => {
      const out = new Map<string, string[]>()
      for (const t of titles) if (files[t]) out.set(t, files[t])
      return out
    }),
    fetchImageUrls: vi.fn(
      async (names: string[]) => new Map(names.map((n) => [n, `https://ms.yugipedia.com/a/${n}`]))
    )
  }
}

const GALLERY = {
  'Card Gallery:Dark Magician': [
    'DarkMagician-LOB-EN-UR-UE.png',
    'DarkMagician-LOB-EN-UR-1E.png',
    'DarkMagician-SDY-NA-UR-1E.png'
  ]
}

describe('createPrintingArtResolver', () => {
  it('batches lookups for several printings into one gallery request and stores the answers', async () => {
    const db = await seededDb()
    const client = fakeClient(GALLERY)
    const art = createPrintingArtResolver({ db, client, batchWaitMs: 0 })
    const [lob, sdy] = await Promise.all([
      art.url(printing(db, 'LOB-EN005')),
      art.url(printing(db, 'SDY-006'))
    ])
    expect(lob).toBe('https://ms.yugipedia.com/a/DarkMagician-LOB-EN-UR-1E.png')
    expect(sdy).toBe('https://ms.yugipedia.com/a/DarkMagician-SDY-NA-UR-1E.png')
    expect(client.listPageImages).toHaveBeenCalledTimes(1)
    expect(client.listPageImages).toHaveBeenCalledWith(['Card Gallery:Dark Magician'])

    // Answered from the database next time.
    expect(await art.url(printing(db, 'LOB-EN005'))).toBe(lob)
    expect(client.listPageImages).toHaveBeenCalledTimes(1)
  })

  it('remembers a printing with no scan, and retries failures', async () => {
    const db = await seededDb()
    const client = fakeClient({})
    const art = createPrintingArtResolver({ db, client, batchWaitMs: 0 })
    expect(await art.url(printing(db, 'LOB-EN119'))).toBeNull()
    expect(await art.url(printing(db, 'LOB-EN119'))).toBeNull()
    expect(client.listPageImages).toHaveBeenCalledTimes(1)

    const failing = fakeClient(GALLERY)
    failing.listPageImages.mockRejectedValueOnce(new Error('offline'))
    const art2 = createPrintingArtResolver({ db, client: failing, batchWaitMs: 0 })
    const id = printing(db, 'LOB-EN005')
    expect(await art2.url(id)).toBeNull()
    expect(await art2.url(id)).toBe('https://ms.yugipedia.com/a/DarkMagician-LOB-EN-UR-1E.png')
  })

  it("finds an uncoded printing's scan from its set's prefix, preferring its variant", async () => {
    const db = await seededDb()
    const card = (db.prepare("SELECT id FROM cards WHERE name = 'Dark Magician'").get() as { id: number }).id
    const insert = db.prepare(
      `INSERT INTO card_printings (card_id, language, set_name, set_code, set_rarity, set_rarity_code,
         missing_from_api, variant)
       VALUES (?, 'ja', 'Original Artwork Collection', ?, ?, '', 0, ?) RETURNING id`
    )
    insert.get(card, 'YAC1-JP001', 'Ultra Rare', null)
    insert.get(card, 'YAC1-JP002', 'Secret Rare', null)
    insert.get(card, 'OTHER-JP001', 'Common', null)
    const manga = (insert.get(card, '', 'Ultra Rare', 'Manga-Style') as { id: number }).id
    const client = fakeClient({
      'Card Gallery:Dark Magician': [
        'DarkMagician-YAC1-JP-UR.png',
        'DarkMagician-YAC1-JP-UR-MangaStyle-Monochrome.png',
        'DarkMagician-YAC1-JP-UR-MangaStyle-Color.png'
      ]
    })
    const art = createPrintingArtResolver({ db, client, batchWaitMs: 0 })
    expect(await art.url(manga)).toBe(
      'https://ms.yugipedia.com/a/DarkMagician-YAC1-JP-UR-MangaStyle-Color.png'
    )
  })

  it('answers null for unknown printings', async () => {
    const db = await seededDb()
    const art = createPrintingArtResolver({ db, client: fakeClient(GALLERY), batchWaitMs: 0 })
    expect(await art.url(999999)).toBeNull()
  })
})
