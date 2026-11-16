import { describe, expect, it } from 'vitest'
import { seededDb } from './helpers'
import { writeTwinPackArt } from '../../scripts/catalog/pokemon/setArt'

async function db() {
  const d = await seededDb()
  const set = d.prepare(
    "INSERT INTO sets (game, language, set_name, set_code) VALUES ('pkm', ?, ?, ?)"
  )
  const pack = d.prepare(
    `INSERT INTO pokemon_set_art (language, set_name, kind, sort_order, image_url, image_key)
     VALUES (?, ?, 'pack', ?, ?, ?)`
  )
  set.run('ja', 'Heat Wave Arena', 'SV9a')
  set.run('ja', 'Battle Partners', 'SV9')
  pack.run('ja', 'Heat Wave Arena', 0, 'https://x/sv9a-0.png', 'bg-sv9a-0')
  pack.run('ja', 'Heat Wave Arena', 1, 'https://x/sv9a-1.png', 'bg-sv9a-1')
  set.run('zh-hant', '熱風競技場', 'SV9a')
  set.run('zh-hant', '對戰搭檔', 'SV9') // its twin has no pack
  set.run('zh-hant', '起始牌組', 'SVHK') // no twin
  set.run('en', 'Phantasmal Flames', 'PFL')
  pack.run('en', 'Phantasmal Flames', 0, 'https://x/pfl.png', 'bg-pfl')
  set.run('fr', 'Flammes Fantasmagoriques', 'PFL')
  set.run('en', '30th Celebration', '30C')
  set.run('en', '30th Classic Collection', '30C')
  pack.run('en', '30th Celebration', 0, 'https://x/30c.png', 'bg-30c')
  set.run('fr', '30ᵉ Anniversaire', '30C')
  return d
}

const packs = (d: Awaited<ReturnType<typeof db>>, lang: string) =>
  d
    .prepare(
      "SELECT set_name, sort_order, image_key FROM pokemon_set_art WHERE language = ? AND kind = 'pack' ORDER BY set_name, sort_order"
    )
    .all(lang)

describe('writeTwinPackArt', () => {
  it("gives a Traditional Chinese set its Japanese twin's packs, by code", async () => {
    const d = await db()
    expect(writeTwinPackArt(d)).toBe(3)
    expect(packs(d, 'zh-hant')).toEqual([
      { set_name: '熱風競技場', sort_order: 0, image_key: 'bg-sv9a-0' },
      { set_name: '熱風競技場', sort_order: 1, image_key: 'bg-sv9a-1' }
    ])
  })

  it("gives a French set its English twin's pack, but not where the code is shared", async () => {
    const d = await db()
    writeTwinPackArt(d)
    expect(packs(d, 'fr')).toEqual([
      { set_name: 'Flammes Fantasmagoriques', sort_order: 0, image_key: 'bg-pfl' }
    ])
  })

  it("replaces last night's rows, so a twin that lost its pack takes it away", async () => {
    const d = await db()
    writeTwinPackArt(d)
    d.exec("DELETE FROM pokemon_set_art WHERE language = 'en'")
    writeTwinPackArt(d)
    expect(packs(d, 'fr')).toEqual([])
    expect(packs(d, 'zh-hant')).toHaveLength(2)
  })
})
