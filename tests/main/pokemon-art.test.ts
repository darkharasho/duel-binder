import { describe, it, expect } from 'vitest'
import { ART_GROUPS, findArt, findArtByName } from '../../scripts/catalog/pokemon/art'
import { englishNamer } from '../../scripts/catalog/pokemon/englishNames'
import {
  isSameNumber,
  matchProducts,
  namesCard,
  sameCardName,
  speciesCheck
} from '../../scripts/catalog/pokemon/match'
import type { PkmLang, TcProduct, TdCard, TdSet } from '../../scripts/catalog/pokemon/types'

const set = (id: string, official?: number): TdSet => ({
  id,
  name: id,
  cards: [],
  cardCount: { official }
})
const card = (localId: string, over: Partial<TdCard> = {}): TdCard => ({
  id: `x-${localId}`,
  localId,
  name: 'x',
  set: { id: 'x', name: 'x' },
  ...over
})
const product = (productId: number, name: string, number: string | null, groupId = 1): TcProduct => ({
  productId,
  groupId,
  name,
  number,
  imageUrl: `https://tcgplayer-cdn.tcgplayer.com/product/${productId}_200w.jpg`
})
const art = (id: number): string => `https://tcgplayer-cdn.tcgplayer.com/product/${id}_200w.jpg`

/** findArt over one list of products, in the set's first hand-picked group. */
function find(lang: PkmLang, s: TdSet, c: TdCard, names: string[], products: TcProduct[]) {
  const g = ART_GROUPS[lang][s.id]?.[0] ?? 1
  return findArt(lang, s, 1, c, names, new Map([[g, products]]))
}

describe('sameCardName', () => {
  it.each([
    ['Pokémon Catcher', 'Pokemon Catcher (Noivern)'],
    ['Professor’s Letter', "Professor's Letter (Sylveon)"],
    ['M Lucario-EX', 'M Lucario EX - 55a/111'],
    ['Umbreon ☆', 'Umbreon Star'],
    ['Dratini δ', 'Dratini (Delta Species)'],
    ['MUK -004/092', 'Muk - 004/092'],
    ["Erika's Tangela", "Erika's Tangela -743/742"],
    ['Togetic', "Falkner's Togetic"],
    ['Tornadus-EX', 'Tornadus EX - BW96 (Prerelease)']
  ])('%s is %s', (a, b) => expect(sameCardName(a, b)).toBe(true))

  it.each([
    ['Misty', 'Delcatty'],
    ['Lightning Energy', 'Fighting Energy (#3)'],
    ['Noibat', 'Pokemon Catcher (Sylveon)'],
    ['ピカチュウ', 'Pikachu']
  ])('%s is not %s', (a, b) => expect(sameCardName(a, b)).toBe(false))
})

describe('isSameNumber', () => {
  it('reads the promo, suffix and encoded forms', () => {
    expect(isSameNumber('BW04', 'BW004')).toBe(true)
    expect(isSameNumber('TG06', 'TG06/TG30')).toBe(true)
    expect(isSameNumber('H25', 'H25/H32')).toBe(true)
    expect(isSameNumber('55a', '055a/111')).toBe(true)
    expect(isSameNumber('%3F', '?/28')).toBe(true)
    expect(isSameNumber('001', '001/SV-P')).toBe(true)
  })
  it('keeps different numbers apart', () => {
    expect(isSameNumber('50a', '050b/147')).toBe(false)
    expect(isSameNumber('BW04', 'XY04')).toBe(false)
    expect(isSameNumber('BW04', 'BW40')).toBe(false)
  })
})

describe('findArt', () => {
  it('needs the set, number and name to agree', () => {
    const s = set('E1', 128)
    const c = card('018')
    const abra = product(10, 'Abra', '018/128')
    expect(find('ja', s, c, ['Abra'], [abra]).imageUrl).toBe(art(10))
    expect(find('ja', s, c, ['Kadabra'], [abra])).toEqual({ imageUrl: null, outcome: 'no name' })
    expect(find('ja', s, card('019'), ['Abra'], [abra]).outcome).toBe('no number')
    expect(find('ja', set('neo1', 96), c, ['Abra'], [abra]).outcome).toBe('no number')
  })

  it("gives a LEGEND's two halves of one name their own art", () => {
    const s = set('30th-c', 55)
    const top = product(716199, 'Darkrai & Cresselia Legend (Top)', '99/102')
    const bottom = product(716200, 'Darkrai & Cresselia Legend (Bottom)', '100/102')
    const half = (localId: string): TdCard => card(localId, { id: `30th-c-${localId}` })
    const names = ['Darkrai & Cresselia LEGEND']
    expect(findArt('en', s, null, half('019'), names, new Map([[24837, [top, bottom]]])).imageUrl).toBe(art(716199))
    expect(findArt('en', s, null, half('020'), names, new Map([[24837, [top, bottom]]])).imageUrl).toBe(art(716200))
  })

  it('leaves a set with no group alone', () => {
    const r = findArt('ja', set('neo1', 96), null, card('001'), ['Oddish'], new Map())
    expect(r).toEqual({ imageUrl: null, outcome: 'no group' })
  })

  it('never compares a Japanese name, but takes the species', () => {
    const s = set('PCG4', 106)
    const unown = product(10, 'Unown - 043/106', '043/106')
    expect(find('ja', s, card('043'), ['未知'], [unown])).toEqual({
      imageUrl: null,
      outcome: 'japanese name'
    })
    expect(find('ja', s, card('043'), ['未知', 'Unown'], [unown]).imageUrl).toBe(art(10))
  })

  it('takes the plain product over its noted printings', () => {
    const s = set('E1', 128)
    const hits = [
      product(10, 'Mewtwo - 118/128 (No Rarity Symbol)', '118/128'),
      product(11, 'Mewtwo - 118/128', '118/128')
    ]
    expect(find('ja', s, card('118'), ['Mewtwo'], hits).imageUrl).toBe(art(11))
  })

  it('takes the first of finish-only products: one art', () => {
    const hits = [
      product(11, 'Professor Sycamore - 107a/122 (Non-Holo)', '107a/122'),
      product(10, 'Professor Sycamore - 107a/122 (Holofoil)', '107a/122')
    ]
    expect(find('en', set('xya', 6), card('107a'), ['Professor Sycamore'], hits).imageUrl).toBe(art(10))
  })

  it('drops the staff stamp, even in a name left unclosed', () => {
    const hits = [
      product(10, 'Chesnaught (Prerelease)', 'XY68'),
      product(11, 'Chesnaught - XY68 (Prerelease [Staff]', 'XY68')
    ]
    expect(find('en', set('xyp'), card('XY68'), ['Chesnaught'], hits).imageUrl).toBe(art(10))
  })

  it('stays empty when the products differ by more than a finish', () => {
    const hits = [
      product(10, 'Pikachu (Stamped A)', '001/128'),
      product(11, 'Pikachu (Stamped B)', '001/128')
    ]
    expect(find('ja', set('E1', 128), card('001'), ['Pikachu'], hits).outcome).toBe('unsettled')
    const twins = [product(10, "Janine's Arbok", '062/141'), product(11, "Janine's Arbok", '062/141')]
    expect(find('ja', set('VS1', 141), card('062'), ["Janine's Arbok"], twins).imageUrl).toBeNull()
  })

  it('keeps out a deck numbered on its own inside a Japanese group', () => {
    const hits = [product(10, 'Oddish - 001/023', '001/023'), product(11, 'Oddish', '001/742')]
    expect(find('ja', set('MC', 742), card('001'), ['Oddish'], hits).imageUrl).toBe(art(11))
  })

  it('tells a Trainer Kit deck by name, in a group holding both decks', () => {
    const hits = [product(10, 'Noibat (#23)', '23/30'), product(11, 'Pokemon Catcher (Sylveon)', '23/30')]
    expect(find('en', set('tk-xy-n'), card('23'), ['Noibat'], hits).imageUrl).toBe(art(10))
    expect(find('en', set('tk-xy-sy'), card('23'), ['Pokémon Catcher'], hits).imageUrl).toBe(art(11))
  })

  describe('a set numbered on its own', () => {
    const s = set('cel25cc', 25)
    const blastoise = product(250319, 'Blastoise', '2/102')
    const linked = card('CC001', { variants_detailed: [{ type: 'holo', thirdParty: { tcgplayer: 250319 } }] })

    it("goes by the variant's product id, with the name", () => {
      expect(find('en', s, linked, ['Blastoise'], [blastoise]).imageUrl).toBe(art(250319))
      expect(find('en', s, linked, ['Charizard'], [blastoise]).outcome).toBe('no name')
    })
    it('takes nothing by name alone', () => {
      expect(find('en', s, card('CC001'), ['Blastoise'], [blastoise]).outcome).toBe('no number')
    })
  })

  it('skips a product with no image', () => {
    const p = { ...product(10, 'Abra', '018/128'), imageUrl: undefined }
    expect(find('ja', set('E1', 128), card('018'), ['Abra'], [p]).imageUrl).toBeNull()
  })
})

describe('findArtByName', () => {
  const entry = (id: string, ...names: string[]) => ({ id, names })
  const run = (cards: { id: string; names: string[] }[], products: TcProduct[]) =>
    Object.fromEntries(findArtByName(1, cards, new Map([[1, products]])))

  it('takes the one product of a name', () => {
    expect(run([entry('a', 'Caterpie')], [product(10, 'Caterpie', null)])).toEqual({ a: art(10) })
  })
  it('leaves out two cards on one product, and a card on two', () => {
    expect(
      run([entry('a', 'Pikachu'), entry('b', 'Pikachu')], [product(10, 'Pikachu', null)])
    ).toEqual({})
    expect(
      run([entry('a', 'Pikachu')], [product(10, 'Pikachu', null), product(11, 'Pikachu', null)])
    ).toEqual({})
  })
  it('lets the same name beat the same base name', () => {
    const hits = [product(10, 'Gyarados', null), product(11, 'Shining Gyarados', null)]
    expect(run([entry('a', 'Gyarados'), entry('b', 'Shining Gyarados')], hits)).toEqual({
      a: art(10),
      b: art(11)
    })
  })
  it('never lands a Dark and a Light card on one species', () => {
    const hits = [product(10, 'Dark Dragonite', null), product(11, 'Light Dragonite', null)]
    expect(run([entry('a', 'Dragonite')], hits)).toEqual({})
  })
  it('skips a Japanese name and a product with no image', () => {
    expect(run([entry('a', 'ベリー')], [product(10, 'Berry', null)])).toEqual({})
    const bare = { ...product(10, 'Caterpie', null), imageUrl: undefined }
    expect(run([entry('a', 'Caterpie')], [bare])).toEqual({})
  })
})

describe('matchProducts by number', () => {
  const misty = card('005', { name: 'Misty' })
  const delcatty = product(716156, 'Delcatty', '5/109')

  it('rejects a product of the same number and another name, when asked to check', () => {
    const m = matchProducts(misty, 1, [delcatty], new Map(), namesCard)
    expect(m.products).toEqual([])
    expect(m.problems).toHaveLength(1)
  })
  it('keeps a matching name', () => {
    const m = matchProducts(card('005', { name: 'Delcatty' }), 1, [delcatty], new Map(), namesCard)
    expect(m.products.map((p) => p.product.productId)).toEqual([716156])
  })
  it('leaves Japanese cards as they were', () => {
    const m = matchProducts(card('005', { name: 'エネコロロ' }), 1, [delcatty], new Map())
    expect(m.products).toHaveLength(1)
  })
})

describe('namesCard', () => {
  const pokemon = (name: string): TdCard => card('1', { name, category: 'Pokemon' })
  const trainer = (name: string): TdCard => card('1', { name, category: 'Trainer' })
  const energy = (name: string): TdCard => card('1', { name, category: 'Energy' })

  it.each([
    [pokemon('Dark Raichu'), 'Raichu'],
    [pokemon('Pikachu ex'), 'Pikachu'],
    [pokemon('Metagross δ'), 'Metagross (Delta Species)'],
    [pokemon('Palkia'), 'Palkia LV.X'],
    [pokemon('Gengar'), 'Gengar (Prime)'],
    [pokemon('Tornadus-EX'), 'Tornadus EX - BW96 (Prerelease)'],
    [pokemon('Flying Pikachu'), 'Pikachu (Flying)'],
    [pokemon('Unown A'), 'Unown [A]'],
    [pokemon('Finizen'), 'Finizen 60/197'],
    [energy('Water Energy'), 'Basic Water Energy (Blue Border)'],
    [energy('δ Rainbow Energy'), 'Delta Rainbow Energy'],
    [pokemon('Drowzee'), 'Drowsee'],
    [pokemon('Dark Exeggutor'), 'Dark Exeggcutor'],
    [pokemon('ナッシー[Exeggutor]'), 'Exeggutor'],
    [trainer('Impostor Professor Oak'), 'Imposter Professor Oak'],
    [trainer('Miracle Sphere β'), 'Miracle Sphere Beta'],
    [trainer('Fairy Charm Lightning'), 'Fairy Charm L'],
    [energy('Hiding Darkness Energy'), 'Hiding D Energy'],
    [energy('Unit Energy GrassFireWater'), 'Unit Energy GRW (Secret Rare)'],
    [energy('Blend Energy Grass Fire Psychic Darkness'), 'Blend Energy GFPD']
  ])('takes the product, case %#', (c, name) => expect(namesCard(c, name)).toBe(true))

  it.each([
    [trainer('Switch'), 'Potion (Bulbasaur)'],
    [trainer('Switch'), 'Granbull (#29)'],
    [pokemon('Charmander'), 'Bulbasaur'],
    [pokemon('Toedscruel ex'), 'Rayquaza - 22/107 (2004-2005 Gym Challenge)'],
    [pokemon('Genesect EX'), 'Charizard'],
    [pokemon('Darkrai & Cresselia LEGEND'), 'Dark Tyranitar'],
    [pokemon('Mew'), 'Mewtwo']
  ])('refuses the product, case %#', (c, name) => expect(namesCard(c, name)).toBe(false))
})

describe('speciesCheck', () => {
  const en = (name: string, dex: number): TdCard =>
    card('1', { name, category: 'Pokemon', dexId: [dex] })
  const ja = (name: string, dex: number): TdCard =>
    card('1', { name, category: 'Pokemon', dexId: [dex] })
  const enCards = [en('Bulbasaur', 1), en('Bellsprout', 69), en('Garbodor', 569), en('Bunnelby', 659)]
  const jaCards = [ja('フシギダネ', 1), ja('マダツボミ', 69), ja('ダストダス', 569), ja('ホルビー', 659)]
  const ok = speciesCheck(enCards, jaCards)

  it('refuses a product of another species', () => {
    expect(ok(ja('エリカのフシギダネ', 1), "Erika's Bellsprout (Lv.13)")).toBe(false)
  })
  it('takes the same species under an owner, prefix or suffix', () => {
    expect(ok(ja('エリカのフシギダネ', 1), "Erika's Bulbasaur (Lv.13)")).toBe(true)
    expect(ok(ja('フシギダネV', 1), 'Dark Bulbasaur V - 001/100')).toBe(true)
  })
  it('trusts the Japanese name over a wrong dexId', () => {
    expect(ok(ja('ダストダス', 659), 'Garbodor - 132/SV-P')).toBe(true)
  })
  it('says nothing when the product species has no Japanese name to go by', () => {
    const check = speciesCheck([...enCards, en('Arctovish', 883)], jaCards)
    expect(check(ja('ウオチルドンV', 881), 'Arctovish V - 017/070')).toBe(true)
  })
  it('says nothing about a name no English card uses, or a card with no dexId', () => {
    expect(ok(ja('フシギダネ', 1), 'Some New Thing')).toBe(true)
    expect(ok(card('1', { name: 'きずぐすり', category: 'Trainer' }), 'Bulbasaur')).toBe(true)
  })
})

describe('matchProducts against a wrong TCGdex id', () => {
  const potion = product(524026, 'Potion (Bulbasaur)', null)
  const own = product(524034, 'Switch (Squirtle)', null)
  const byId = new Map([potion, own].map((p) => [p.productId, p]))
  const switchCard = card('34', {
    name: 'Switch',
    category: 'Trainer',
    variants_detailed: [
      { type: 'normal', stamp: ['squirtle'], thirdParty: { tcgplayer: 524034 } },
      { type: 'normal', stamp: ['bulbasaur'], thirdParty: { tcgplayer: 524026 } }
    ]
  })

  it('drops the id naming another card and keeps the card\'s own', () => {
    const m = matchProducts(switchCard, 1, [], byId, namesCard)
    expect(m.products.map((p) => p.product.productId)).toEqual([524034])
    expect(m.problems).toEqual(['x-34: TCGplayer product 524026 is "Potion (Bulbasaur)"; rejected'])
  })
})

describe('matchProducts in a set numbered on its own', () => {
  const inSet = (localId: string, name: string, over: Partial<TdCard> = {}): TdCard =>
    card(localId, { name, category: 'Pokemon', set: { id: '30th-c', name: '30th Classic Collection' }, ...over })
  const charizard = product(714372, 'Charizard', '4/102')
  const genesect = product(716158, 'Genesect EX (Team Plasma)', '11/101')
  const gengar = product(716198, 'Gengar (Prime)', '94/102')
  const misty = product(716159, 'Misty', '18/132')
  const top = product(716199, 'Darkrai & Cresselia Legend (Top)', '99/102')
  const bottom = product(716200, 'Darkrai & Cresselia Legend (Bottom)', '100/102')
  const list = [charizard, genesect, gengar, misty, top, bottom]
  const ids = (c: TdCard): number[] =>
    matchProducts(c, 1, list, new Map(), namesCard).products.map((p) => p.product.productId)

  it('goes by name, not the number that lands on another card', () => {
    expect(ids(inSet('004', 'Genesect EX'))).toEqual([716158])
    expect(ids(inSet('018', 'Gengar'))).toEqual([716198])
  })
  it('leaves a card out when two products take its name', () => {
    expect(ids(inSet('019', 'Darkrai & Cresselia LEGEND'))).toEqual([])
  })
  it('takes a TCGdex id whose Number is the reprinted card\'s, when the name agrees', () => {
    const c = (name: string): TdCard =>
      inSet('001', name, { variants_detailed: [{ type: 'holo', thirdParty: { tcgplayer: 714372 } }] })
    const byId = new Map([[714372, charizard]])
    expect(matchProducts(c('Charizard'), 1, [], byId, namesCard).products).toHaveLength(1)
    expect(matchProducts(c('Blastoise'), 1, [], byId, namesCard).products).toEqual([])
  })
})

describe('englishNamer.speciesOf', () => {
  const en = { id: 'a', localId: '1', name: 'Dark Unown', category: 'Pokemon', dexId: [201], set: { id: 's', name: 's' } }
  const namer = englishNamer([en], [], [])

  it('names one Pokémon by its dexId', () => {
    expect(namer.speciesOf(card('1', { dexId: [201] }))).toBe('Unown')
  })
  it('has nothing for a card of two, or none', () => {
    expect(namer.speciesOf(card('1', { dexId: [201, 25] }))).toBeNull()
    expect(namer.speciesOf(card('1'))).toBeNull()
  })
})
