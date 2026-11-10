import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { mtgRows } from '../../scripts/catalog/magic/rows'
import { isKept, parseBulkLines } from '../../scripts/catalog/magic/scryfall'
import type { ScryCard, ScrySet } from '../../scripts/catalog/magic/types'
import { mtgBackImageId, mtgCardId, mtgImageId } from '../../src/shared/games/ids'

async function* lines(text: string): AsyncIterable<string> {
  for (const l of text.split('\n')) yield l
}
async function load(): Promise<{ objects: ScryCard[]; sets: ScrySet[] }> {
  const objects: ScryCard[] = []
  for await (const c of parseBulkLines(
    lines(readFileSync('tests/fixtures/scryfall/default-cards.sample.json', 'utf8'))
  )) {
    if (isKept(c)) objects.push(c)
  }
  const sets = (
    JSON.parse(readFileSync('tests/fixtures/scryfall/sets.sample.json', 'utf8')) as {
      data: ScrySet[]
    }
  ).data
  return { objects, sets }
}
const byName = (objects: ScryCard[], name: string): ScryCard => {
  const c = objects.find((o) => o.name.startsWith(name))
  if (!c) throw new Error(name)
  return c
}

describe('mtgRows', () => {
  it('one card per oracle id', async () => {
    const { objects, sets } = await load()
    const rows = mtgRows(objects, sets)
    const oid = byName(objects, 'Admiral Beckett').oracle_id as string
    const id = mtgCardId('en', oid)
    expect(rows.cards.get(id)?.oracleId).toBe(oid)
    expect(rows.images.filter((i) => i.cardId === id)).toHaveLength(2)
    expect(rows.cards.size).toBe(new Set(rows.images.map((i) => i.cardId)).size)
  })

  it('finishes and prices', async () => {
    const { objects, sets } = await load()
    const rows = mtgRows(objects, sets)
    const of = (n: string) => rows.printings.filter((p) => p.scryfallId === byName(objects, n).id)
    expect(of('Eldrazi').map((p) => [p.finish, p.rarity, p.price])).toEqual([
      ['nonfoil', 'Common', 0.19],
      ['foil', 'Common (Foil)', 0.26]
    ])
    expect(of('Akiri').map((p) => [p.finish, p.rarity, p.price])).toEqual([
      ['etched', 'Mythic (Etched Foil)', 4.13]
    ])
    expect(of('Elspeth').map((p) => [p.finish, p.rarity, p.price])).toEqual([
      ['foil', 'Mythic (Foil)', null]
    ])
  })

  it('treats bad prices as null', async () => {
    const { objects, sets } = await load()
    const o = structuredClone(byName(objects, 'Eldrazi'))
    o.prices = { usd: '-1', usd_foil: 'abc', usd_etched: null }
    const rows = mtgRows([o], sets)
    expect(rows.printings.map((p) => p.price)).toEqual([null, null])
  })

  it('set_code keeps the collector number exactly', async () => {
    const { objects, sets } = await load()
    const rows = mtgRows(objects, sets)
    const codes = rows.printings.map((p) => p.code)
    expect(codes).toContain('9ED 213★')
    expect(codes).toContain('PLST XLN-217')
    expect(rows.printings.find((p) => p.code === 'MH3 150')?.setCode).toBe('MH3')
  })

  it('transform card', async () => {
    const { objects, sets } = await load()
    const rows = mtgRows(objects, sets)
    const o = byName(objects, 'Delver')
    const card = rows.cards.get(mtgCardId('en', o.oracle_id as string))!
    expect(card.name).toBe(o.name)
    expect(card.desc).toBe(`${o.card_faces![0].oracle_text}\n//\n${o.card_faces![1].oracle_text}`)
    expect(JSON.parse(card.faces as string)).toHaveLength(2)
    expect(card.types).toEqual(['Creature'])
    expect(rows.images.filter((i) => i.scryfallId === o.id)).toHaveLength(1)
    expect(card.manaCost).toBe('{U}')
    expect(card.colors).toEqual(['U'])
  })

  it("reversible card takes face 0's oracle id", async () => {
    const { objects, sets } = await load()
    const rows = mtgRows(objects, sets)
    const o = byName(objects, 'Adrix')
    expect(o.oracle_id).toBeUndefined()
    const id = mtgCardId('en', o.card_faces![0].oracle_id as string)
    expect(rows.cards.get(id)?.oracleId).toBe(o.card_faces![0].oracle_id)
    expect(rows.images.find((i) => i.scryfallId === o.id)?.imageId).toBe(mtgImageId(o.id))
  })

  describe('reversible card and its normal printing', () => {
    const normalOf = (rev: ScryCard): ScryCard => ({
      ...structuredClone(rev),
      id: '00000000-0000-4000-8000-0000000000aa',
      oracle_id: rev.card_faces![0].oracle_id,
      name: 'Adrix and Nev, Twincasters',
      layout: 'normal',
      collector_number: '901',
      mana_cost: '{2}{G}{U}',
      cmc: 4,
      type_line: 'Legendary Creature - Merfolk Druid',
      oracle_text: 'Normal rules text.',
      card_faces: undefined
    })

    it('the normal printing names the card whichever comes first', async () => {
      const { objects, sets } = await load()
      const rev = byName(objects, 'Adrix')
      const normal = normalOf(rev)
      for (const order of [
        [rev, normal],
        [normal, rev]
      ]) {
        const rows = mtgRows(order, sets)
        const card = rows.cards.get(mtgCardId('en', normal.oracle_id as string))!
        expect(rows.cards.size).toBe(1)
        expect(card.name).toBe('Adrix and Nev, Twincasters')
        expect(card.oracleText).toBe('Normal rules text.')
        expect(card.desc).toBe('Normal rules text.')
        expect(card.manaValue).toBe(4)
        expect(card.manaCost).toBe('{2}{G}{U}')
        expect(card.layout).toBe('normal')
        expect(card.faces).toBeNull()
      }
    })

    it('a reversible object alone is a card of face 0, not a doubled one', async () => {
      const { objects, sets } = await load()
      const rev = structuredClone(byName(objects, 'Adrix'))
      rev.card_faces![0].oracle_text = 'Face zero text.'
      rev.card_faces![0].mana_cost = '{3}'
      rev.card_faces![0].cmc = 3
      const card = [...mtgRows([rev], sets).cards.values()][0]
      expect(card.name).toBe(rev.card_faces![0].name)
      expect(card.name).not.toContain('//')
      expect(card.oracleText).toBe('Face zero text.')
      expect(card.desc).toBe('Face zero text.')
      expect(card.manaCost).toBe('{3}')
      expect(card.manaValue).toBe(3)
      expect(card.faces).toBeNull()
      expect(card.layout).not.toBe('reversible_card')
    })

    it('a double-faced token without an oracle id is face 0 too', async () => {
      const { objects, sets } = await load()
      const tok = structuredClone(byName(objects, 'Adrix'))
      tok.layout = 'double_faced_token'
      tok.name = 'Soldier // Spirit'
      tok.card_faces![0].name = 'Soldier'
      const card = [...mtgRows([tok], sets).cards.values()][0]
      expect(card.name).toBe('Soldier')
    })
  })

  it('token types', async () => {
    const { objects, sets } = await load()
    const rows = mtgRows(objects, sets)
    const tok = rows.cards.get(mtgCardId('en', byName(objects, 'Angel').oracle_id as string))!
    expect(tok.types).toEqual(expect.arrayContaining(['Token', 'Creature']))
    expect(tok.type).toBe('Creature')
    const art = rows.cards.get(mtgCardId('en', byName(objects, 'Abundant').oracle_id as string))!
    expect(art.type).toBe('Other')
  })

  it('colors', async () => {
    const { objects, sets } = await load()
    const rows = mtgRows(objects, sets)
    const c = (n: string) =>
      rows.cards.get(mtgCardId('en', byName(objects, n).oracle_id as string))!
    expect(c('Akiri').colors).toEqual(['R', 'W'])
    expect(c('Eldrazi').colors).toEqual([])
    const two = structuredClone(byName(objects, 'Delver'))
    two.card_faces![1].colors = ['B', 'W']
    const r2 = mtgRows([two], sets)
    expect([...r2.cards.values()][0].colors).toEqual(
      ['W', 'U', 'B'].sort((a, b) => 'WUBRG'.indexOf(a) - 'WUBRG'.indexOf(b))
    )
    const land = structuredClone(byName(objects, 'Eldrazi'))
    land.colors = []
    expect([...mtgRows([land], sets).cards.values()][0].colors).toEqual([])
  })

  it('series from parent set', async () => {
    const { objects, sets } = await load()
    const rows = mtgRows(objects, sets)
    expect(rows.sets.get('en|TMH3')).toMatchObject({
      name: 'Modern Horizons 3 Tokens',
      series: 'Modern Horizons 3'
    })
    expect(rows.sets.get('en|MH3')).toMatchObject({
      series: 'Modern Horizons 3',
      releasedAt: '2024-06-14'
    })
    expect(rows.sets.has('en|CMR')).toBe(true)
  })

  it('a set missing from the list is named after the object', async () => {
    const { objects } = await load()
    const rows = mtgRows([byName(objects, 'Eldrazi')], [])
    expect(rows.sets.get('en|MH3')).toMatchObject({
      name: 'Modern Horizons 3',
      series: 'Modern Horizons 3'
    })
  })

  it('unknown rarity and duplicate printing are notes', async () => {
    const { objects, sets } = await load()
    const dup = { ...structuredClone(byName(objects, 'Eldrazi')), id: 'dup-id-1' }
    const rows = mtgRows([...objects, dup], sets)
    const abolish = byName(objects, 'Abolish')
    expect(rows.notes).toContain(`unknown Magic rarity masterpiece: ${abolish.id}`)
    expect(rows.printings.some((p) => p.scryfallId === abolish.id)).toBe(false)
    expect(rows.notes).toContain('duplicate Magic printing MH3 150 nonfoil: dup-id-1')
    expect(rows.notes).toContain('duplicate Magic printing MH3 150 foil: dup-id-1')
    expect(rows.images.some((i) => i.scryfallId === 'dup-id-1')).toBe(false)
    expect(rows.notes.some((n) => n.includes(byName(objects, 'Eldrazi').id))).toBe(false)
  })
})

describe('mtgRows languages, back faces and borrowed art', () => {
  const base = (o: Partial<ScryCard> & { id: string }): ScryCard => ({
    oracle_id: 'o-1',
    name: 'Bolt',
    lang: 'en',
    layout: 'normal',
    set: 'mh3',
    set_name: 'Modern Horizons 3',
    collector_number: '1',
    rarity: 'common',
    released_at: '2024-06-14',
    games: ['paper'],
    digital: false,
    finishes: ['nonfoil'],
    prices: { usd: '1', usd_foil: null, usd_etched: null },
    type_line: 'Instant',
    oracle_text: 'Deal 3.',
    color_identity: ['R'],
    keywords: [],
    frame: '2015',
    border_color: 'black',
    full_art: false,
    image_status: 'highres_scan',
    image_uris: {},
    ...o
  })
  const en = base({ id: 'e1' })
  const ja = base({ id: 'j1', lang: 'ja', name: '稲妻', printed_name: '稲妻', oracle_text: 'x' })
  const img = (rows: ReturnType<typeof mtgRows>, id: string) =>
    rows.images.find((i) => i.scryfallId === id)!

  it('builds a card, printings and set per language, English twin or not', () => {
    for (const objs of [
      [en, ja],
      [ja, en]
    ]) {
      const rows = mtgRows(objs, [])
      const c = rows.cards.get(mtgCardId('ja', 'o-1'))!
      expect([c.lang, c.name, c.localName, c.desc]).toEqual(['ja', 'Bolt', '稲妻', 'Deal 3.'])
      expect(rows.cards.get(mtgCardId('en', 'o-1'))!.localName).toBeNull()
      expect(rows.printings.find((p) => p.scryfallId === 'j1')!.language).toBe('ja')
      expect([...rows.sets.keys()].sort()).toEqual(['en|MH3', 'ja|MH3'])
      expect(rows.notes).toEqual([])
      expect(rows.printings).toHaveLength(2)
    }
  })

  it('keeps its own text without an English twin; no local name when equal', () => {
    const ru = base({
      id: 'r1',
      lang: 'ru',
      oracle_id: 'o-2',
      name: 'Молния',
      printed_name: 'Молния'
    })
    const c = mtgRows([ru], []).cards.get(mtgCardId('ru', 'o-2'))!
    expect([c.name, c.desc, c.localName]).toEqual(['Молния', 'Deal 3.', null])
  })

  it('joins face printed names and sets back image ids', () => {
    const face = (name: string, printed: string, images: boolean) => ({
      name,
      printed_name: printed,
      ...(images ? { image_uris: {} } : {})
    })
    const t = base({
      id: 't1',
      lang: 'de',
      oracle_id: 'o-3',
      name: 'A // B',
      layout: 'transform',
      card_faces: [face('A', 'Aa', true), face('B', 'Bb', true)]
    })
    const adv = base({
      id: 'a1',
      oracle_id: 'o-4',
      name: 'C // D',
      layout: 'adventure',
      card_faces: [face('C', 'C', false), face('D', 'D', false)]
    })
    const rows = mtgRows([t, adv], [])
    expect(img(rows, 't1').backImageId).toBe(mtgBackImageId('t1'))
    expect(img(rows, 'a1').backImageId).toBeNull()
    expect(rows.cards.get(mtgCardId('de', 'o-3'))!.localName).toBe('Aa // Bb')
  })

  it('borrows art from an English twin for placeholders', () => {
    const de = base({ id: 'd1', lang: 'de', image_status: 'placeholder' })
    const fr = base({ id: 'f1', lang: 'fr', collector_number: '9', image_status: 'placeholder' })
    const enMissing = base({ id: 'e2', collector_number: '9', image_status: 'missing' })
    const low = base({ id: 'l1', lang: 'es', image_status: 'lowres' })
    const rows = mtgRows([de, fr, enMissing, low, en], [])
    expect(img(rows, 'd1').artFrom).toBe('e1')
    expect(img(rows, 'f1').artFrom).toBe('none')
    expect(img(rows, 'e2').artFrom).toBe('none')
    expect(img(rows, 'l1').artFrom).toBeNull()
    expect(img(rows, 'e1').artFrom).toBeNull()
  })
})
