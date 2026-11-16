import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PNG } from 'pngjs'
import { describe, expect, it } from 'vitest'
import { openDatabase } from '../../src/main/db/database'
import { HAND_ART_PREFIX } from '../../src/shared/imageSources'
import {
  archivePacks,
  officialSetOf,
  packCopy,
  packKey,
  packUrl,
  parseOfficialProducts,
  writeZhPackArt
} from '../../scripts/catalog/pokemon/zhPacks'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'

const NAMES = new Map([
  ['CSV8C', '璀璨诡幻'],
  ['CBB7C', '宝石包 VOL.7'],
  ['CSV10.5C', '黑雷奔流'],
  ['30thC', '30周年庆典']
])

describe('parseOfficialProducts', () => {
  it('reads each product name and its picture', () => {
    const html = readFileSync(join(__dirname, '../fixtures/pokipair/cn-products.html'), 'utf8')
    const products = parseOfficialProducts(html)
    expect(products.map((p) => p.name)).toEqual([
      'Pokémon宝石包 VOL.7',
      '宝可梦集换式卡牌游戏 补充包 30周年庆典',
      '补充包 璀璨诡幻',
      '黑雷奔流硬币套装'
    ])
    expect(products[2].image).toMatch(
      /^https:\/\/image\.pokemon\.com\.cn\/wp-content\/uploads\/.*\.png\?auth_key=/
    )
  })
})

describe('officialSetOf', () => {
  it.each([
    ['补充包 璀璨诡幻', 'CSV8C'],
    ['Pokémon宝石包 VOL.7', 'CBB7C'],
    ['Pokémon宝石包VOL.7', 'CBB7C'],
    ['宝可梦集换式卡牌游戏 补充包 30周年庆典', '30thC']
  ])('%s is %s', (name, id) => {
    expect(officialSetOf(name, NAMES)).toBe(id)
  })

  it('takes no accessory named after a set, and no name two sets share', () => {
    expect(officialSetOf('黑雷奔流硬币套装', NAMES)).toBeNull()
    expect(officialSetOf('补充包 璀璨诡幻', new Map([...NAMES, ['X', '璀璨诡幻']]))).toBeNull()
  })
})

describe('pack copies', () => {
  it('keeps a see-through PNG, no wider than 480', () => {
    const p = new PNG({ width: 960, height: 1600 })
    p.data.fill(0) // all clear
    const out = packCopy(new Uint8Array(PNG.sync.write(p)))!
    const back = PNG.sync.read(Buffer.from(out))
    expect(back.width).toBe(480)
    expect(back.data[3]).toBe(0)
    expect(packCopy(new Uint8Array([1, 2, 3]))).toBeNull()
  })

  it('keys a pack by its source, ignoring the expiring auth key', () => {
    const a = packKey('https://image.pokemon.com.cn/x/1.png?auth_key=1-a')
    expect(a).toMatch(/^hp-[0-9a-f]{20}$/)
    expect(packKey('https://image.pokemon.com.cn/x/1.png?auth_key=2-b')).toBe(a)
    expect(packKey('https://media.pokipair.com/y.png')).not.toBe(a)
    expect(packUrl('CSV9.5C')).toBe(`${HAND_ART_PREFIX}zh-hans-pack-csv9-5c/pack.png`)
  })
})

describe('writeZhPackArt with nothing copied', () => {
  it('leaves the rows it has (a lost record must not wipe them)', () => {
    const db = openDatabase(join(mkdtempSync(join(tmpdir(), 'zh-packs-')), 'work.sqlite'))
    db.prepare(
      "INSERT INTO pokemon_set_art (language, set_name, kind, sort_order, image_url, image_key) VALUES ('zh-hans', 'Old', 'pack', 0, 'x', 'hp-old')"
    ).run()
    writeZhPackArt(db, {})
    expect(db.prepare('SELECT COUNT(*) AS n FROM pokemon_set_art').get()).toEqual({ n: 1 })
    db.close()
  })
})

describe('writeZhPackArt', () => {
  it("writes each copied pack under its set's name, replacing last night's", () => {
    const db = openDatabase(join(mkdtempSync(join(tmpdir(), 'zh-packs-')), 'work.sqlite'))
    const addPrinting = (setId: string, setName: string, n: number): void => {
      db.prepare(
        `INSERT INTO cards (id, game, name, type, frame_type, race, "desc", updated_at)
         VALUES (?, 'pkm', 'x', 'Pokemon', 'pokemon', '', '', 'x')`
      ).run(n)
      db.prepare(
        "INSERT INTO pokemon_cards (card_id, category, source_id) VALUES (?, 'Pokemon', ?)"
      ).run(n, `zh-hans/${setId}-001`)
      db.prepare(
        `INSERT INTO card_printings (game, card_id, language, set_name, set_code, set_rarity)
         VALUES ('pkm', ?, 'zh-hans', ?, ?, 'Common')`
      ).run(n, setName, `${setId} 001`)
    }
    addPrinting('CSV8C', 'Sparkling Fable', 1)
    addPrinting('CBB7C', 'Gem Pack Vol. 7', 2)
    db.prepare(
      "INSERT INTO pokemon_set_art (language, set_name, kind, sort_order, image_url, image_key) VALUES ('zh-hans', 'Old', 'pack', 0, 'x', 'hp-old')"
    ).run()
    db.prepare(
      "INSERT INTO pokemon_set_art (language, set_name, kind, sort_order, image_url, image_key) VALUES ('en', 'Base', 'pack', 0, 'y', 'bp-base')"
    ).run()
    writeZhPackArt(db, {
      CSV8C: 'https://media.pokipair.com/csv8.png',
      CBB7C: 'https://image.pokemon.com.cn/gem7.png',
      NOPE: 'https://media.pokipair.com/nope.png'
    })
    const rows = db
      .prepare(
        'SELECT language, set_name, image_url, image_key FROM pokemon_set_art ORDER BY set_name'
      )
      .all()
    expect(rows).toEqual([
      { language: 'en', set_name: 'Base', image_url: 'y', image_key: 'bp-base' },
      {
        language: 'zh-hans',
        set_name: 'Gem Pack Vol. 7',
        image_url: packUrl('CBB7C'),
        image_key: packKey('https://image.pokemon.com.cn/gem7.png')
      },
      {
        language: 'zh-hans',
        set_name: 'Sparkling Fable',
        image_url: packUrl('CSV8C'),
        image_key: packKey('https://media.pokipair.com/csv8.png')
      }
    ])
    db.close()
  })
})

describe('archivePacks', () => {
  const file = (title: string, width = 300, height = 520) => ({
    title,
    url: `https://archives.bulbagarden.net/media/upload/x/${title}`,
    width,
    height
  })
  const ids = ['CSVH1aC', 'CS4aC', 'CSM2.1C', 'CSV9.5C', 'SVPC']

  it("names each set's pack by its code, the biggest of its packs", () => {
    const m = archivePacks(
      [
        file('CSVH1a Pack.png'),
        file('CS4a Booster 5 Pack.png', 200, 350),
        file('CS4a Booster 25 Pack.png', 400, 700),
        file('CSM2.1 Pack.png'),
        file('CSV9.5 Pack.png')
      ],
      ids
    )
    expect(Object.fromEntries(m)).toEqual({
      CSVH1aC: expect.stringMatching(/CSVH1a Pack/),
      CS4aC: expect.stringMatching(/CS4a Booster 25 Pack/),
      'CSM2.1C': expect.stringMatching(/CSM2\.1 Pack/),
      'CSV9.5C': expect.stringMatching(/CSV9\.5 Pack/)
    })
  })

  it('takes no promo or event pack, no box, and nothing from another site', () => {
    const m = archivePacks(
      [
        file('SVP Mission Pack 1 SC.png'),
        file('151 Booster Gather 20 Pack.png'),
        file('CSVH1a Pack.png', 600, 400),
        { ...file('CS4a Pack.png'), url: 'https://example.com/CS4a.png' }
      ],
      ids
    )
    expect(m.size).toBe(0)
  })
})
