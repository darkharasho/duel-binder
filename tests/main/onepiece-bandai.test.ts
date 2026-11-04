import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { parseCardList, parseSeriesList } from '../../scripts/catalog/onepiece/bandai'

const read = (name: string): string => readFileSync(join(__dirname, '../fixtures/onepiece', name), 'utf8')

describe('Bandai card list parser', () => {
  test('series list', () => {
    const { series: s, notes } = parseSeriesList(read('bandai-op17.html'))
    expect(notes).toEqual([])
    expect(s).toEqual([
      { id: '569117', kind: 'booster', title: 'THE WORLD’S STRONGEST WARRIORS', code: 'OP-17', setName: 'THE WORLD’S STRONGEST WARRIORS [OP-17]', setCode: 'OP17' },
      { id: '569115', kind: 'booster', title: 'ADVENTURE ON KAMI’S ISLAND', code: 'OP15-EB04', setName: 'ADVENTURE ON KAMI’S ISLAND [OP15-EB04]', setCode: 'OP15-EB04' },
      { id: '569901', kind: 'promo', title: 'Promotion Cards', code: 'P', setName: 'Promotion Cards', setCode: 'P' }
    ])
  })
  test('a Leader, an Event with a trigger, a parallel and an SP', () => {
    const { entries, skipped } = parseCardList(read('bandai-op17.html'), '569117')
    const by = Object.fromEntries(entries.map((e) => [e.bandaiId, e]))
    expect(skipped).toEqual([])
    expect(by['OP17-001']).toMatchObject({ number: 'OP17-001', rarity: 'L', cardType: 'Leader', name: 'Edward.Newgate',
      life: 5, cost: null, power: 5000, counter: null, colors: ['Red'], attribute: ['Special'],
      traits: ['The Four Emperors', 'Whitebeard Pirates'], block: 5, trigger: null })
    expect(by['OP17-019'].name).toBe("I Don't Have Time to Chat with Snot-Nosed Brats")
    expect(by['OP17-019']).toMatchObject({ cardType: 'Event', cost: 1, attribute: [], trigger: '[Trigger] Your Leader gains +1000 power during this turn.' })
    expect(by['OP17-005_p2']).toMatchObject({ number: 'OP17-005', rarity: 'SR', block: null })
    expect(by['OP14-108_p3']).toMatchObject({ number: 'OP14-108', rarity: 'SP' })
    expect(by['EB04-061_p2']).toMatchObject({ number: 'EB04-061', rarity: 'SEC', cardSets: 'BOOSTER PACK -THE WORLD’S STRONGEST WARRIORS- [OP-17]' })
  })
  test('a line break in an effect becomes a newline', () => {
    const { entries } = parseCardList(read('bandai-op17.html'), '569117')
    const e = entries.find((x) => x.bandaiId === 'OP17-005_p2')!
    expect(e.effect).toMatch(/^If your opponent has a Character with 10000 power or more, give this card in your hand −4 cost\.\n\[On Play\]/)
  })
  test('promo entries name their product', () => {
    const { entries } = parseCardList(read('bandai-promo.html'), '569901')
    expect(entries.map((e) => e.cardSets)).toEqual([
      'Offline Regional Participation Pack 2025 Vol.1',
      'Offline Regional Finalist Card Set 25-26 Season 1'
    ])
  })
  test('an id that is not a Bandai id is skipped', () => {
    const html = read('bandai-op17.html').replace('id="OP17-019"', 'id="../x"')
    expect(parseCardList(html, '569117').skipped).toEqual(['../x'])
  })
  test('a series of an unknown kind is a booster, with a note', () => {
    const html = read('bandai-op17.html').replace('BOOSTER PACK &lt;br', 'MYSTERY PACK &lt;br')
    const { series, notes } = parseSeriesList(html)
    expect(series[0]).toMatchObject({ id: '569117', kind: 'booster', setCode: 'OP17' })
    expect(notes).toEqual(['569117: unknown series kind "MYSTERY PACK", read as a booster'])
  })
})
