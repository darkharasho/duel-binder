import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { matchGroup, matchProducts } from '../../scripts/catalog/pokemon/match'
import { alwaysFoil, cardVersions, canonicalLabel, groupFinish, productTreatment, variantLabel } from '../../scripts/catalog/pokemon/versions'
import type { TcGroup, TcPrice, TcProduct, TdCard, TdSet, TdVariant } from '../../scripts/catalog/pokemon/types'
import { movedEnough } from '../../src/main/tcgplayer/prices'

const FIX = join(__dirname, '..', 'fixtures', 'pokemon')
const read = <T>(p: string): T => JSON.parse(readFileSync(join(FIX, p), 'utf8')) as T

type Cat = '3' | '85'
const groups = (cat: Cat): TcGroup[] =>
  read<{ results: { groupId: number; name: string; abbreviation?: string | null }[] }>(`tcgcsv/${cat}/groups.json`)
    .results.map((g) => ({ groupId: g.groupId, name: g.name, abbreviation: g.abbreviation ?? null }))

/** Every fixture product of a category, mapped the way tcgcsvProducts maps them. */
function allProducts(cat: Cat): TcProduct[] {
  const out: TcProduct[] = []
  for (const f of readdirSync(join(FIX, 'tcgcsv', cat)).filter((n) => n.startsWith('products-'))) {
    const rows = read<{ results: { productId: number; groupId: number; name: string; imageUrl?: string; extendedData?: { name: string; value: string }[] }[] }>(`tcgcsv/${cat}/${f}`).results
    for (const p of rows) {
      out.push({
        productId: p.productId, groupId: p.groupId, name: p.name, imageUrl: p.imageUrl,
        number: p.extendedData?.find((e) => e.name === 'Number')?.value ?? null
      })
    }
  }
  return out
}

function allPrices(cat: Cat): Map<number, TcPrice[]> {
  const m = new Map<number, TcPrice[]>()
  for (const f of readdirSync(join(FIX, 'tcgcsv', cat)).filter((n) => n.startsWith('prices-'))) {
    for (const p of read<{ results: { productId: number; subTypeName: string; marketPrice?: number | null }[] }>(`tcgcsv/${cat}/${f}`).results) {
      const row = { productId: p.productId, subTypeName: p.subTypeName, marketPrice: p.marketPrice ?? null }
      m.set(p.productId, [...(m.get(p.productId) ?? []), row])
    }
  }
  return m
}

interface Lang { cat: Cat; dir: 'en' | 'ja'; products: TcProduct[]; productById: Map<number, TcProduct>; productGroup: Map<number, number>; prices: Map<number, TcPrice[]>; groups: TcGroup[] }
function lang(dir: 'en' | 'ja'): Lang {
  const cat: Cat = dir === 'en' ? '3' : '85'
  const products = allProducts(cat)
  return {
    cat, dir, products, groups: groups(cat), prices: allPrices(cat),
    productById: new Map(products.map((p) => [p.productId, p])),
    productGroup: new Map(products.map((p) => [p.productId, p.groupId]))
  }
}
const EN = lang('en')
const JA = lang('ja')

const set = (l: Lang, id: string): TdSet => read<TdSet>(`${l.dir}/set-${id}.json`)
const card = (l: Lang, id: string): TdCard => read<TdCard>(`${l.dir}/card-${id}.json`)
const setCards = (l: Lang, id: string): TdCard[] => set(l, id).cards.map((c) => card(l, c.id))
const inGroup = (l: Lang, g: number | null): TcProduct[] => l.products.filter((p) => p.groupId === g)
const group = (l: Lang, setId: string): number | null => matchGroup(set(l, setId), setCards(l, setId), l.groups, l.productGroup)

function versionsOf(l: Lang, id: string, prices = l.prices): ReturnType<typeof cardVersions> & { match: ReturnType<typeof matchProducts> } {
  const c = card(l, id)
  const g = group(l, c.set.id)
  const match = matchProducts(c, g, inGroup(l, g), l.productById)
  return { ...cardVersions(c, match.products, prices), match }
}

const prod = (productId: number, groupId: number, number: string | null): TcProduct => ({ productId, groupId, name: `P${productId}`, number })
const brief = (over: Partial<TdCard>): TdCard => ({ id: 'x-001', localId: '001', name: 'X', set: { id: 'x', name: 'X' }, ...over })

describe('matchGroup', () => {
  it('votes by product ids (sv01 → 22873)', () => {
    expect(group(EN, 'sv01')).toBe(22873)
  })
  it('votes with variant ids only (PMCG1 → 23721 via 575571)', () => {
    expect(group(JA, 'PMCG1')).toBe(23721)
  })
  it('votes with card-level ids (M1L → 24399, SV1S → 23605)', () => {
    expect(group(JA, 'M1L')).toBe(24399)
    expect(group(JA, 'SV1S')).toBe(23605)
  })
  it('falls back to the abbreviation, case insensitive, using the set id when TCGdex has none (M4 → 24653)', () => {
    expect(group(JA, 'M4')).toBe(24653)
  })
  it('falls back to the normalized name, stripping a leading code', () => {
    const s: TdSet = { id: 'zz9', name: 'Ninja-Spinner!', cards: [] }
    expect(matchGroup(s, [], JA.groups, JA.productGroup)).toBe(24653)
  })
  it('returns null when nothing matches', () => {
    const s: TdSet = { id: 'nope', name: 'No Such Set', abbreviation: { official: 'NSS' }, cards: [] }
    expect(matchGroup(s, [], JA.groups, JA.productGroup)).toBeNull()
  })
  it('refuses a vote below half and a non-unique name hit', () => {
    const gs: TcGroup[] = [
      { groupId: 1, name: 'A: Same', abbreviation: 'AA' },
      { groupId: 2, name: 'B: Same', abbreviation: 'aa' },
      { groupId: 3, name: 'Other', abbreviation: null }
    ]
    const pg = new Map([[10, 1], [11, 2], [12, 3], [13, 1]])
    const cards = [10, 11, 12].map((t, i) => brief({ id: `s-${i}`, thirdParty: { tcgplayer: t } }))
    // 1 of 3 each: no vote. Abbreviation 'AA' hits two groups. Name 'Same' hits two groups.
    expect(matchGroup({ id: 's', name: 'Same', abbreviation: { official: 'AA' }, cards: [] }, cards, gs, pg)).toBeNull()
    // Two of three in group 1: vote wins.
    const two = [10, 13, 12].map((t, i) => brief({ id: `s-${i}`, thirdParty: { tcgplayer: t } }))
    expect(matchGroup({ id: 's', name: 'Same', cards: [] }, two, gs, pg)).toBe(1)
  })
  it('counts ids missing from every group against the vote', () => {
    const gs: TcGroup[] = [{ groupId: 1, name: 'G', abbreviation: null }]
    const cards = [10, 98, 99].map((t, i) => brief({ id: `s-${i}`, thirdParty: { tcgplayer: t } }))
    expect(matchGroup({ id: 's', name: 'Nope', cards: [] }, cards, gs, new Map([[10, 1]]))).toBeNull()
  })
})

describe('matchProducts', () => {
  it('fills by number when the card has no ids (M4-001 → Weedle 683652)', () => {
    const c = card(JA, 'M4-001')
    const r = matchProducts(c, 24653, inGroup(JA, 24653), JA.productById)
    expect(r.products.map((p) => [p.product.productId, p.variantSubtype])).toEqual([[683652, null]])
    expect(r.problems).toEqual([])
  })
  it('gives no match when two products share the number', () => {
    const ps = [prod(1, 9, '001/083'), prod(2, 9, '1/083'), prod(3, 9, null)]
    const r = matchProducts(brief({}), 9, ps, new Map(ps.map((p) => [p.productId, p])))
    expect(r.products).toEqual([])
  })
  it('compares non-numeric numbers as exact strings', () => {
    const ps = [prod(1, 9, 'TG01/TG30'), prod(2, 9, 'TG1/TG30')]
    const r = matchProducts(brief({ localId: 'TG01' }), 9, ps, new Map(ps.map((p) => [p.productId, p])))
    expect(r.products.map((p) => p.product.productId)).toEqual([1])
  })
  it('ignores leading zeros before a letter suffix (ecard2-50a is TCGplayer 050a/147), and keeps the suffix', () => {
    const p = prod(85813, 9, '050a/147')
    const byId = new Map([[85813, p]])
    const a = matchProducts(brief({ id: 'ecard2-50a', localId: '50a', thirdParty: { tcgplayer: 85813 } }), 9, [p], byId)
    expect(a.products.map((m) => m.product.productId)).toEqual([85813])
    expect(a.problems).toEqual([])
    const b = matchProducts(brief({ id: 'ecard2-50b', localId: '50b', thirdParty: { tcgplayer: 85813 } }), 9, [p], byId)
    expect(b.products).toEqual([])
    expect(b.problems).toHaveLength(1)
    expect(matchProducts(brief({ localId: '50a' }), 9, [p], byId).products.map((m) => m.product.productId)).toEqual([85813])
  })
  it('never number-fills without a group', () => {
    const ps = [prod(1, 9, '001/083')]
    expect(matchProducts(brief({}), null, ps, new Map(ps.map((p) => [p.productId, p]))).products).toEqual([])
  })
  it('rejects an id whose Number disagrees with localId, with a problem', () => {
    const p = prod(5, 9, '005/083')
    const r = matchProducts(brief({ thirdParty: { tcgplayer: 5 } }), 9, [p], new Map([[5, p]]))
    expect(r.products).toEqual([])
    expect(r.problems).toHaveLength(1)
    expect(r.problems[0]).toContain('5')
  })
  it('uses variant ids with their subtypes, deduplicated (base1-4)', () => {
    const r = matchProducts(card(EN, 'base1-4'), 604, inGroup(EN, 604), EN.productById)
    expect(r.products.map((p) => [p.product.productId, p.variantSubtype])).toEqual([[42382, null], [106999, 'shadowless']])
  })
  it('uses the card-level id when the variants have none (M1L-001 → 647110)', () => {
    const r = matchProducts(card(JA, 'M1L-001'), 24399, inGroup(JA, 24399), JA.productById)
    expect(r.products.map((p) => p.product.productId)).toEqual([647110])
  })
  it('reports an id that is in no product list (PMCG1-001 576998)', () => {
    const r = matchProducts(card(JA, 'PMCG1-001'), 23721, inGroup(JA, 23721), JA.productById)
    expect(r.products.map((p) => p.product.productId)).toEqual([575571])
    expect(r.problems.some((p) => p.includes('576998'))).toBe(true)
  })
})

describe('labels', () => {
  it('maps TCGplayer subtypes to the canonical vocabulary', () => {
    expect(canonicalLabel('Unlimited Holofoil')).toBe('Holofoil')
    expect(canonicalLabel('Unlimited')).toBe('Normal')
    expect(canonicalLabel('Normal')).toBe('Normal')
    expect(canonicalLabel('Reverse Holofoil')).toBe('Reverse Holofoil')
    expect(canonicalLabel('1st Edition')).toBe('1st Edition')
    expect(canonicalLabel('1st Edition Holofoil')).toBe('1st Edition Holofoil')
    expect(canonicalLabel('Something New')).toBe('Something New')
  })
  it('labels several stamps the same whatever order TCGdex lists them in', () => {
    const a = variantLabel({ type: 'holo', stamp: ['staff', 'set-logo'] })
    expect(variantLabel({ type: 'holo', stamp: ['set-logo', 'staff', 'staff'] })).toBe(a)
    expect(a).toBe('Set Logo Staff Holofoil')
  })

  it('reads the 1st-edition stamp however TCGdex spells it ("1st edition", "1st Edition")', () => {
    expect(variantLabel({ type: 'normal', stamp: ['1st edition'] })).toBe('1st Edition')
    expect(variantLabel({ type: 'normal', stamp: ['1st Edition'] })).toBe('1st Edition')
    expect(variantLabel({ type: 'holo', stamp: ['1st edition'] })).toBe('1st Edition Holofoil')
    const c = brief({ variants_detailed: [{ type: 'normal', stamp: ['1st edition'] }] })
    expect(cardVersions(c, [], new Map()).problems).toEqual([])
  })
  it('maps TCGdex variants to the same vocabulary', () => {
    expect(variantLabel({ type: 'normal' })).toBe('Normal')
    expect(variantLabel({ type: 'holo' })).toBe('Holofoil')
    expect(variantLabel({ type: 'reverse' })).toBe('Reverse Holofoil')
    expect(variantLabel({ type: 'normal', stamp: ['1st-edition'] })).toBe('1st Edition')
    expect(variantLabel({ type: 'holo', stamp: ['1st-edition'] })).toBe('1st Edition Holofoil')
    expect(variantLabel({ type: 'holo', subtype: 'unlimited' })).toBe('Holofoil')
    expect(variantLabel({ type: 'holo', subtype: 'shadowless', stamp: ['1st-edition'] })).toBe('Shadowless 1st Edition Holofoil')
    expect(variantLabel({ type: 'normal', subtype: 'no-rarity' })).toBe('No Rarity Normal')
  })
})

describe('cardVersions', () => {
  it('prices sv01-001 per subtype, sorted by label', () => {
    const { versions } = versionsOf(EN, 'sv01-001')
    expect(versions).toEqual([
      { label: 'Normal', productId: 487828, subTypeName: 'Normal', price: 0.12 },
      { label: 'Reverse Holofoil', productId: 487828, subTypeName: 'Reverse Holofoil', price: 0.22 }
    ])
  })
  it('adds a Holofoil that TCGdex lists only as normal (SV1S-001)', () => {
    const prices = new Map(JA.prices)
    prices.set(567118, [...(prices.get(567118) ?? []), { productId: 567118, subTypeName: 'Holofoil', marketPrice: 0.3 }])
    const { versions } = versionsOf(JA, 'SV1S-001', prices)
    expect(versions).toEqual([
      { label: 'Holofoil', productId: 567118, subTypeName: 'Holofoil', price: 0.3 },
      { label: 'Normal', productId: 567118, subTypeName: 'Normal', price: 0.15 }
    ])
  })
  it('prefixes shadowless versions of base1-4 and prices each from its own product', () => {
    const { versions, problems } = versionsOf(EN, 'base1-4')
    expect(versions).toEqual([
      { label: '1999 2000 Copyright Holofoil', productId: null, subTypeName: null, price: null },
      { label: 'Holofoil', productId: 42382, subTypeName: 'Holofoil', price: 954.65 },
      { label: 'Shadowless 1st Edition Holofoil', productId: 106999, subTypeName: '1st Edition Holofoil', price: null },
      { label: 'Shadowless Holofoil', productId: 106999, subTypeName: 'Unlimited Holofoil', price: 2172.24 }
    ])
    expect(problems).toEqual([])
  })
  it('leaves every version of a product reached under two variant subtypes unpriced', () => {
    const base = card(EN, 'base1-4')
    const c: TdCard = {
      ...base,
      variants_detailed: [
        { type: 'holo', subtype: 'unlimited', thirdParty: { tcgplayer: 42382 } },
        { type: 'holo', subtype: '1999-2000-copyright', thirdParty: { tcgplayer: 42382 } }
      ]
    }
    const match = matchProducts(c, 604, inGroup(EN, 604), EN.productById)
    expect(match.products.map((p) => [p.product.productId, p.variantSubtype])).toEqual([[42382, null], [42382, '1999-2000-copyright']])
    const { versions, problems } = cardVersions(c, match.products, EN.prices)
    expect(versions).toEqual([
      { label: '1999 2000 Copyright Holofoil', productId: null, subTypeName: null, price: null },
      { label: 'Holofoil', productId: null, subTypeName: null, price: null }
    ])
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('42382')
  })
  it('treats no subtype and unlimited as one subtype for the same product', () => {
    const p = prod(1, 9, null)
    const prices = new Map([[1, [{ productId: 1, subTypeName: 'Holofoil', marketPrice: 4 }]]])
    const r = cardVersions(brief({ variants_detailed: [{ type: 'holo' }] }), [{ product: p, variantSubtype: null }, { product: p, variantSubtype: 'unlimited' }], prices)
    expect(r.versions).toEqual([{ label: 'Holofoil', productId: 1, subTypeName: 'Holofoil', price: 4 }])
    expect(r.problems).toEqual([])
  })
  it('keeps the no-rarity variant of PMCG1-001 unpriced', () => {
    const { versions } = versionsOf(JA, 'PMCG1-001')
    expect(versions).toEqual([
      { label: 'No Rarity Normal', productId: null, subTypeName: null, price: null },
      { label: 'Normal', productId: 575571, subTypeName: 'Normal', price: 6.98 }
    ])
  })
  it('leaves a label two products share unpriced, with one problem', () => {
    const a = prod(1, 9, '001/010')
    const b = prod(2, 9, '001/010')
    const prices = new Map([
      [1, [{ productId: 1, subTypeName: 'Holofoil', marketPrice: 1 }]],
      [2, [{ productId: 2, subTypeName: 'Holofoil', marketPrice: 2 }]]
    ])
    const c = brief({ variants_detailed: [{ type: 'holo' }] })
    const { versions, problems } = cardVersions(c, [{ product: a, variantSubtype: null }, { product: b, variantSubtype: null }], prices)
    expect(versions).toEqual([{ label: 'Holofoil', productId: null, subTypeName: null, price: null }])
    expect(problems).toHaveLength(1)
  })
  it('gives an unmatched card its TCGdex versions with no price', () => {
    const c = brief({ variants_detailed: [{ type: 'normal' }, { type: 'reverse' }] })
    expect(cardVersions(c, [], new Map()).versions).toEqual([
      { label: 'Normal', productId: null, subTypeName: null, price: null },
      { label: 'Reverse Holofoil', productId: null, subTypeName: null, price: null }
    ])
  })
  it('never takes a price from another subtype', () => {
    const p = prod(1, 9, '001/010')
    const prices = new Map([[1, [{ productId: 1, subTypeName: 'Normal', marketPrice: 5 }]]])
    const c = brief({ variants_detailed: [{ type: 'normal' }, { type: 'reverse' }] })
    expect(cardVersions(c, [{ product: p, variantSubtype: null }], prices).versions).toEqual([
      { label: 'Normal', productId: 1, subTypeName: 'Normal', price: 5 },
      { label: 'Reverse Holofoil', productId: 1, subTypeName: null, price: null }
    ])
  })
  it('only takes a positive finite market price', () => {
    const p = prod(1, 9, null)
    for (const marketPrice of [null, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const prices = new Map([[1, [{ productId: 1, subTypeName: 'Normal', marketPrice }]]])
      expect(cardVersions(brief({}), [{ product: p, variantSubtype: null }], prices).versions[0].price).toBeNull()
    }
  })
  it('reports a subtype outside the table and labels it verbatim', () => {
    const p = prod(1, 9, null)
    const prices = new Map([[1, [{ productId: 1, subTypeName: 'Cosmos Holofoil', marketPrice: 3 }]]])
    const r = cardVersions(brief({}), [{ product: p, variantSubtype: null }], prices)
    expect(r.versions).toEqual([{ label: 'Cosmos Holofoil', productId: 1, subTypeName: 'Cosmos Holofoil', price: 3 }])
    expect(r.problems).toHaveLength(1)
  })
  it('makes a TCGdex cosmos foil its own version, beside the plain one', () => {
    const labels = (id: string, variants_detailed: TdVariant[]): string[] =>
      cardVersions(brief({ id, variants_detailed }), [], new Map()).versions.map((v) => v.label)
    const plain = { type: 'normal', variantId: 'a' }
    const cosmosHolo = { type: 'holo', foil: 'cosmos', variantId: 'b' }
    const cosmosNormal = { type: 'normal', foil: 'cosmos', variantId: 'c' }
    expect(labels('sv09-135', [plain, cosmosHolo])).toEqual(['Cosmos Holo', 'Normal'])
    expect(labels('sv03-148', [plain, cosmosNormal])).toEqual(['Cosmos Holo', 'Normal'])
  })
  it('leaves a card whose only variant is cosmos under its label, so no key moves', () => {
    const v = { type: 'holo', foil: 'cosmos', variantId: 'a' }
    const r = cardVersions(brief({ variants_detailed: [v] }), [], new Map())
    expect(r.versions.map((x) => x.label)).toEqual(['Holofoil'])
  })
  it("doesn't add a Cosmos Holo beside TCGplayer's Cosmos Holofoil row", () => {
    const p = prod(1, 9, null)
    const prices = new Map([[1, [{ productId: 1, subTypeName: 'Cosmos Holofoil', marketPrice: 3 }]]])
    const c = brief({ variants_detailed: [{ type: 'normal', variantId: 'a' }, { type: 'holo', foil: 'cosmos', variantId: 'b' }] })
    const labels = cardVersions(c, [{ product: p, variantSubtype: null }], prices).versions.map((x) => x.label)
    expect(labels).toContain('Cosmos Holofoil')
    expect(labels).not.toContain('Cosmos Holo')
  })
  it('adds the Cosmos Holo a Dex export shows and TCGdex lacks', () => {
    const c = brief({ id: 'sv02-098', variants_detailed: [{ type: 'holo', variantId: 'a' }] })
    expect(cardVersions(c, [], new Map()).versions.map((v) => v.label)).toEqual(['Cosmos Holo', 'Holofoil'])
  })
  it('gives a card with no variants and no products a single Normal', () => {
    expect(cardVersions(brief({}), [], new Map()).versions).toEqual([
      { label: 'Normal', productId: null, subTypeName: null, price: null }
    ])
  })
  it('gives the same labels whether a card is matched or not', () => {
    for (const [l, id] of [[EN, 'sv01-001'], [EN, 'base1-4'], [JA, 'PMCG1-001'], [JA, 'SV1S-008'], [JA, 'M4-001']] as const) {
      const c = card(l, id)
      const matched = versionsOf(l, id).versions.map((v) => v.label)
      const unmatched = cardVersions(c, [], new Map()).versions.map((v) => v.label)
      for (const label of unmatched) expect(matched).toContain(label)
    }
  })
})

describe('true finishes', () => {
  const gen = (type: string, stamp?: string[]): TdVariant => ({ type, variantId: 'generated', ...(stamp ? { stamp } : {}) })
  const labels = (r: ReturnType<typeof cardVersions>): string[] => r.versions.map((v) => v.label)

  it('drops TCGdex\'s generated Normal when TCGplayer sells the card only as Holofoil (30th-131)', () => {
    const c = brief({ id: '30th-131', rarity: 'Illustration rare', variants_detailed: [gen('normal')] })
    const p = prod(696683, 24722, '131/128')
    const prices = new Map([[696683, [{ productId: 696683, subTypeName: 'Holofoil', marketPrice: 4.87 }]]])
    const r = cardVersions(c, [{ product: p, variantSubtype: null }], prices)
    expect(r.versions).toEqual([{ label: 'Holofoil', productId: 696683, subTypeName: 'Holofoil', price: 4.87 }])
    expect(r.unverified).toBe(false)
  })
  it('drops generated guesses for a common too: TCGplayer\'s subtypes are the finishes', () => {
    const c = brief({ rarity: 'Common', variants_detailed: [gen('normal'), gen('reverse')] })
    const prices = new Map([[1, [{ productId: 1, subTypeName: 'Holofoil', marketPrice: 0.26 }]]])
    expect(labels(cardVersions(c, [{ product: prod(1, 9, '001/010'), variantSubtype: null }], prices))).toEqual(['Holofoil'])
  })
  it('keeps curated TCGdex variants alongside TCGplayer subtypes', () => {
    const c = brief({ rarity: 'Common', variants_detailed: [{ type: 'normal', variantId: 'endfynwn4n10gzq' }, { type: 'reverse', variantId: 'cm4kqul3x1bwlz1f' }] })
    const prices = new Map([[1, [{ productId: 1, subTypeName: 'Normal', marketPrice: 0.1 }]]])
    expect(labels(cardVersions(c, [{ product: prod(1, 9, null), variantSubtype: null }], prices))).toEqual(['Normal', 'Reverse Holofoil'])
  })
  it('keeps generated variants, flagged unverified, when no TCGplayer row says otherwise', () => {
    const c = brief({ rarity: 'Common', variants_detailed: [gen('normal'), gen('reverse')] })
    const r = cardVersions(c, [{ product: prod(1, 9, null), variantSubtype: null }], new Map())
    expect(labels(r)).toEqual(['Normal', 'Reverse Holofoil'])
    expect(r.versions[0].productId).toBe(1)
    expect(r.unverified).toBe(true)
  })
  it('keeps generated variants when only a subtyped product has rows', () => {
    const c = brief({ rarity: 'Common', variants_detailed: [gen('normal')] })
    const prices = new Map([[2, [{ productId: 2, subTypeName: 'Normal', marketPrice: 1 }]]])
    expect(labels(cardVersions(c, [{ product: prod(2, 9, null), variantSubtype: 'shadowless' }], prices))).toEqual(['Normal', 'Shadowless Normal'])
  })
  it('reads a generated normal of an always-foil rarity as Holofoil, keeping its stamp', () => {
    for (const rarity of ['Illustration rare', 'Special illustration rare', 'Ultra Rare', 'Double rare', 'Holo Rare V', 'ACE SPEC Rare', 'Character Super Rare']) {
      const r = cardVersions(brief({ rarity, variants_detailed: [gen('normal'), gen('normal', ['1st-edition'])] }), [], new Map())
      expect(labels(r)).toEqual(['1st Edition Holofoil', 'Holofoil'])
      expect(r.unverified).toBe(true)
    }
  })
  it('never adds a finish TCGdex did not list for a rarity printed either way', () => {
    for (const rarity of ['Common', 'Rare', 'Promo', 'Holo Rare', 'LEGEND', undefined]) {
      expect(labels(cardVersions(brief({ rarity, variants_detailed: [gen('normal')] }), [], new Map()))).toEqual(['Normal'])
    }
  })
  it('leaves a curated normal of an always-foil rarity alone', () => {
    const c = brief({ rarity: 'Ultra Rare', variants_detailed: [{ type: 'normal', variantId: 'endfynwn4n10gzq' }] })
    expect(labels(cardVersions(c, [], new Map()))).toEqual(['Normal'])
  })
  it('falls back to Holofoil for an always-foil card with no versions at all', () => {
    const r = cardVersions(brief({ rarity: 'Secret Rare' }), [], new Map())
    expect(labels(r)).toEqual(['Holofoil'])
    expect(r.unverified).toBe(true)
  })
  it('takes the finish of a one-finish group that covers the set (30th-c-001)', () => {
    const c = brief({ id: '30th-c-001', rarity: undefined, variants_detailed: [gen('normal')] })
    const r = cardVersions(c, [], new Map(), 'Holofoil')
    expect(r.versions).toEqual([{ label: 'Holofoil', productId: null, subTypeName: null, price: null }])
    expect(r.unverified).toBe(false)
  })
  it('reads a group as one finish only when all its rows agree and they cover the set', () => {
    const products = [prod(1, 9, '4/102'), prod(2, 9, '5/109')]
    const row = (productId: number, subTypeName: string): TcPrice => ({ productId, subTypeName, marketPrice: 1 })
    const holo = new Map([[1, [row(1, 'Holofoil')]], [2, [row(2, 'Holofoil')]]])
    expect(groupFinish(products, holo, 2)).toBe('Holofoil')
    expect(groupFinish(products, holo, 3)).toBeNull()
    const mixed = new Map([[1, [row(1, 'Holofoil')]], [2, [row(2, 'Normal')]]])
    expect(groupFinish(products, mixed, 2)).toBeNull()
    expect(groupFinish(products, new Map(), 0)).toBeNull()
  })
  it('breaks an abbreviation tie by the words of the set name (30th-c → 24837)', () => {
    const tied: TcGroup[] = [
      { groupId: 24722, name: 'ME: 30th Celebration', abbreviation: '30C' },
      { groupId: 24837, name: 'ME: 30th Celebration Classic Collection', abbreviation: '30C' }
    ]
    const s = (id: string, name: string): TdSet => ({ id, name, abbreviation: { official: '30C' }, cards: [] })
    expect(matchGroup(s('30th-c', '30th Classic Collection'), [], tied, new Map())).toBe(24837)
    expect(matchGroup(s('30th', '30th Celebration'), [], tied, new Map())).toBe(24722)
  })
  it('knows which rarities are always foil', () => {
    expect(alwaysFoil('Special illustration rare')).toBe(true)
    expect(alwaysFoil(' hyper RARE ')).toBe(true)
    expect(alwaysFoil('Rare')).toBe(false)
    expect(alwaysFoil(null)).toBe(false)
  })
})

describe('foil patterns', () => {
  const named = (productId: number, name: string): TcProduct => ({ productId, groupId: 1, name, number: '023/086' })
  const row = (productId: number, subTypeName: string, marketPrice: number): TcPrice => ({ productId, subTypeName, marketPrice })
  const variant = (type: string, id: number, variantId: string): TdCard['variants_detailed'] extends (infer V)[] | undefined ? V : never => ({ type, variantId, thirdParty: { tcgplayer: id } })
  const plain = named(1, 'Carracosta')
  const ball = named(2, 'Carracosta (Poke Ball Pattern)')
  const master = named(3, 'Carracosta (Master Ball Pattern)')
  const matched = [plain, ball, master].map((product) => ({ product, variantSubtype: null }))

  it('labels a deck-only non-holo as Deck Exclusive, with its own price (me05-028)', () => {
    const pack = { ...named(704785, 'Miraidon'), number: '028/084' }
    const deck: TcProduct = { productId: 707026, groupId: 1840, name: 'Miraidon - 028/084 (Non-Holo)', number: '028/084' }
    const c = brief({ variants_detailed: [variant('holo', 704785, 'a'), variant('reverse', 704785, 'b'), variant('normal', 707026, 'c')] })
    const prices = new Map<number, TcPrice[]>([
      [704785, [row(704785, 'Holofoil', 0.2), row(704785, 'Reverse Holofoil', 0.29)]],
      [707026, [row(707026, 'Normal', 0.55)]]
    ])
    const r = cardVersions(c, [pack, deck].map((product) => ({ product, variantSubtype: null })), prices)
    expect(r.versions).toEqual([
      { label: 'Deck Exclusive', productId: 707026, subTypeName: 'Normal', price: 0.55 },
      { label: 'Holofoil', productId: 704785, subTypeName: 'Holofoil', price: 0.2 },
      { label: 'Reverse Holofoil', productId: 704785, subTypeName: 'Reverse Holofoil', price: 0.29 }
    ])
  })
  it('keeps Normal for a non-holo product outside Deck Exclusives', () => {
    const p = named(5, 'Sycamore - 107a/122 (Non-Holo)')
    const prices = new Map<number, TcPrice[]>([[5, [row(5, 'Normal', 1)]]])
    const r = cardVersions(brief({ variants_detailed: [variant('normal', 5, 'a')] }), [{ product: p, variantSubtype: null }], prices)
    expect(r.versions.map((v) => v.label)).toEqual(['Normal'])
  })
  it('keeps a pattern sold as Holofoil out of the plain Holofoil, each with its own price', () => {
    const c = brief({ variants_detailed: [variant('holo', 1, 'a'), variant('reverse', 1, 'b'), variant('reverse', 2, 'c'), variant('reverse', 3, 'd')] })
    const prices = new Map<number, TcPrice[]>([
      [1, [row(1, 'Holofoil', 0.19), row(1, 'Reverse Holofoil', 0.27)]],
      [2, [row(2, 'Holofoil', 0.44)]],
      [3, [row(3, 'Holofoil', 13.2)]]
    ])
    expect(cardVersions(c, matched, prices).versions.map((v) => [v.label, v.productId, v.price])).toEqual([
      ['Holofoil', 1, 0.19],
      ['Master Ball Pattern', 3, 13.2],
      ['Poke Ball Pattern', 2, 0.44],
      ['Reverse Holofoil', 1, 0.27]
    ])
  })

  it('gives a Common with only patterns no Holofoil', () => {
    const c = brief({ rarity: 'Common', variants_detailed: [variant('normal', 1, 'a'), variant('reverse', 2, 'c')] })
    const prices = new Map<number, TcPrice[]>([
      [1, [row(1, 'Normal', 0.1)]],
      [2, [row(2, 'Holofoil', 0.5)]]
    ])
    expect(cardVersions(c, matched.slice(0, 2), prices).versions.map((v) => v.label)).toEqual(['Normal', 'Poke Ball Pattern'])
  })

  it('keeps a curated reverse holo TCGplayer has no row for', () => {
    const c = brief({ variants_detailed: [variant('normal', 1, 'a'), variant('reverse', 1, 'b')] })
    const prices = new Map<number, TcPrice[]>([[1, [row(1, 'Normal', 2)]]])
    expect(cardVersions(c, matched.slice(0, 1), prices).versions.map((v) => v.label)).toEqual(['Normal', 'Reverse Holofoil'])
  })

  it('leaves out a curated Normal of a card sold only as Holofoil', () => {
    const c = brief({ variants_detailed: [variant('normal', 1, 'a'), variant('holo', 1, 'b')] })
    const prices = new Map<number, TcPrice[]>([[1, [row(1, 'Holofoil', 2)]]])
    expect(cardVersions(c, matched.slice(0, 1), prices).versions.map((v) => v.label)).toEqual(['Holofoil'])
  })

  it('keeps a curated finish when TCGplayer has no rows to say otherwise', () => {
    const c = brief({ variants_detailed: [variant('normal', 1, 'a'), variant('reverse', 1, 'b')] })
    expect(cardVersions(c, matched.slice(0, 1), new Map()).versions.map((v) => v.label)).toEqual(['Normal', 'Reverse Holofoil'])
  })

  it('names the patterns in one spelling and leaves stamps and plain finish notes alone', () => {
    expect(productTreatment('Erika\'s Oddish (Poke Ball)')).toBe('Poke Ball Pattern')
    expect(productTreatment('Sneasel (Dusk Ball)')).toBe('Dusk Ball Pattern')
    expect(productTreatment('Pawmi (Cosmos Foil)')).toBe('Cosmos Holo')
    expect(productTreatment('Capsule (Cosmo Holo)')).toBe('Cosmos Holo')
    expect(productTreatment('Capsule (Cosmos Holofoil)')).toBe('Cosmos Holo')
    expect(productTreatment('Blastoise - 13/95 (Cracked Ice Holo)')).toBe('Cracked Ice Holo')
    expect(productTreatment('Blastoise (Cracked Ice)')).toBe('Cracked Ice Holo')
    expect(productTreatment('Air Balloon (Great Ball League)')).toBeNull()
    expect(productTreatment('Mail - 92a/108 (Holo)')).toBeNull()
    expect(productTreatment('Sycamore - 107a/122 (Non-Holo)')).toBeNull()
    expect(productTreatment('Raichu - SM65 (#25 Pikachu Stamped)')).toBeNull()
    expect(productTreatment('Carracosta')).toBeNull()
  })
})

describe('movedEnough', () => {
  it('follows MIN_MOVE_USD and MIN_MOVE_SHARE', () => {
    expect(movedEnough(1.0, 1.03)).toBe(false)
    expect(movedEnough(1.0, 1.1)).toBe(true)
    expect(movedEnough(100, 101)).toBe(false) // over 5 cents, under 2%
    expect(movedEnough(100, 103)).toBe(true)
    expect(movedEnough(1, 1)).toBe(false)
  })
  it('treats appearing and disappearing prices as moves', () => {
    expect(movedEnough(null, 1)).toBe(true)
    expect(movedEnough(1, null)).toBe(true)
    expect(movedEnough(null, null)).toBe(false)
  })
})
