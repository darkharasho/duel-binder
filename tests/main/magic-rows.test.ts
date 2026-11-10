import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { mtgRows } from '../../scripts/catalog/magic/rows'
import { isKept, parseBulkLines } from '../../scripts/catalog/magic/scryfall'
import type { ScryCard, ScrySet } from '../../scripts/catalog/magic/types'
import { mtgCardId, mtgImageId } from '../../src/shared/games/ids'

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
    expect(rows.sets.get('TMH3')).toMatchObject({
      name: 'Modern Horizons 3 Tokens',
      series: 'Modern Horizons 3'
    })
    expect(rows.sets.get('MH3')).toMatchObject({
      series: 'Modern Horizons 3',
      releasedAt: '2024-06-14'
    })
    expect(rows.sets.has('CMR')).toBe(true)
  })

  it('a set missing from the list is named after the object', async () => {
    const { objects } = await load()
    const rows = mtgRows([byName(objects, 'Eldrazi')], [])
    expect(rows.sets.get('MH3')).toMatchObject({
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
