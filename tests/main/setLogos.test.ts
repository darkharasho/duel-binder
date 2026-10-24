import { describe, expect, it, vi } from 'vitest'
import { findSetImageUrl, getChecklist, listSets } from '../../src/main/repo/sets'
import { yugipediaImageKey } from '../../src/main/images/cache'
import { refreshSetLogos, shouldRefreshSetLogos } from '../../src/main/yugipedia/setLogos'
import { seededDb } from './helpers'

const PHNI = 'https://ms.yugipedia.com/4/4c/PHNI-LogoEN.png'

describe('set logos', () => {
  it('asks Yugipedia for each English set’s logo and shows the ones it has', async () => {
    const db = await seededDb()
    db.exec(`INSERT INTO sets (language, set_name, set_code) VALUES
      ('en', 'Legend of Blue Eyes White Dragon', 'LOB'), ('en', 'Odd/Code', 'A/B')`)
    const fetchImageUrls = vi.fn(
      async (files: string[]) =>
        new Map(files.filter((f) => f === 'LOB-LogoEN.png').map((f) => [f, PHNI]))
    )
    const now = new Date('2026-10-24T00:00:00Z')
    expect(await refreshSetLogos(db, { fetchImageUrls }, now)).toBe(1)
    expect(fetchImageUrls.mock.calls[0][0]).toContain('LOB-LogoEN.png')
    expect(fetchImageUrls.mock.calls[0][0]).not.toContain('A/B-LogoEN.png')
    expect(shouldRefreshSetLogos(db, now)).toBe(false)

    const key = yugipediaImageKey(PHNI)
    expect(listSets(db).find((s) => s.setCode === 'LOB')!.logoImageKey).toBe(key)
    expect(getChecklist(db, 'Legend of Blue Eyes White Dragon', 'en')?.set.logoImageKey).toBe(key)
    expect(findSetImageUrl(db, key!)).toBe(PHNI)
  })

  it('keeps stored logos when Yugipedia fails', async () => {
    const db = await seededDb()
    db.exec(`INSERT INTO set_logos (set_name, image_url, image_key) VALUES ('X', 'u', 'yp-1')`)
    const fetchImageUrls = vi.fn(async () => {
      throw new Error('down')
    })
    expect(await refreshSetLogos(db, { fetchImageUrls })).toBe(0)
    expect(db.prepare('SELECT count(*) AS n FROM set_logos').get()).toEqual({ n: 1 })
    expect(shouldRefreshSetLogos(db, new Date())).toBe(true)
  })
})
