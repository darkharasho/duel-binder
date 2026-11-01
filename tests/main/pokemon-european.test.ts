import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../../src/main/db/database'
import { CARD_MAX_AGE_MS, europeanCardIsUsable } from '../../scripts/catalog/pokemon/cache'
import {
  EUROPEAN_LANGS,
  europeanCard,
  europeanCards,
  europeanNamer
} from '../../scripts/catalog/pokemon/european'
import { ENGLISH_VOCAB, LOCAL_VOCAB } from '../../scripts/catalog/pokemon/europeanVocab'
import { runPokemonStep } from '../../scripts/catalog/pokemon'
import { createPokemonSources } from '../../scripts/catalog/pokemon/sources'
import { alwaysFoil, cardVersions } from '../../scripts/catalog/pokemon/versions'
import { refreshPokemon } from '../../scripts/catalog/pokemon/write'
import type { PkmLang, PokemonSources, TdCard, TdSet } from '../../scripts/catalog/pokemon/types'
import { pokemonId } from '../../src/shared/games/ids'
import { isPokemonLanguage, liveLanguage } from '../../src/shared/scanWindow'

const card = (id: string, name: string, extra: Partial<TdCard> = {}): TdCard => ({
  id,
  localId: id.slice(id.lastIndexOf('-') + 1),
  name,
  set: { id: id.slice(0, id.lastIndexOf('-')), name: '?' },
  ...extra
})

const CHARIZARD_FR = card('sv03-125', 'Dracaufeu-ex', {
  category: 'Pokémon',
  rarity: 'Double rare',
  types: ['Obscurité'],
  stage: 'Niveau 2',
  dexId: [6],
  hp: 330,
  image: 'https://assets.tcgdex.net/fr/sv/sv03/125',
  thirdParty: { tcgplayer: 509879 },
  variants_detailed: [
    { type: 'Holo', thirdParty: { tcgplayer: 509879 }, variantId: 'jr7oetx1mqug9' }
  ]
})
const CHARIZARD_EN = card('sv03-125', 'Charizard ex', {
  category: 'Pokemon',
  rarity: 'Double rare',
  types: ['Darkness'],
  stage: 'Stage2',
  dexId: [6],
  hp: 330,
  variants_detailed: [{ type: 'holo', variantId: 'jr7oetx1mqug9' }]
})

/** What TCGdex returned for each value on 2026-11-01, without Pocket's rarities. */
const LIVE: Record<(typeof EUROPEAN_LANGS)[number], Record<'rarity' | 'category' | 'stage' | 'types', string[]>> = {
  fr: {
    rarity: ['Chromatique ultra rare', 'Collection Classique', 'Commune', 'Double rare', 'Dresseur Full Art', 'Futuristic Rare', 'HIGH-TECH rare', 'Holo Rare', 'Holo Rare V', 'Holo Rare VMAX', 'Holo Rare VSTAR', 'Hyper rare', 'Illustration rare', 'Illustration spéciale rare', 'LÉGENDE', 'Magnifique', 'Magnifique rare', 'Méga Hyper Rare', 'Peu Commune', 'Pikachu Rare', 'Promo', 'Radieux Rare', 'Rare', 'Rare Holo', 'Rare Holo LV.X', 'Rare Noir Blanc', 'Rare Prime', 'Sans Rareté', 'Shiny rare', 'Shiny rare V', 'Shiny rare VMAX', 'Ultra Rare'],
    category: ['Dresseur', 'Pokémon', 'Énergie'],
    stage: ['Base', 'Bébé', 'MÉGA', 'Niveau 1', 'Niveau 2', 'Niveau Sup', 'Restauré', 'TURBO', 'V-UNION', 'VMAX', 'VSTAR'],
    types: ['Combat', 'Dragon', 'Eau', 'Feu', 'Fée', 'Incolore', 'Métal', 'Obscurité', 'Plante', 'Psy', 'Électrique']
  },
  de: {
    rarity: ['ASS-KLASSE', 'Atemberaubend', 'Doppelselten', 'Futuristic Rare', 'Holografisch Selten', 'Holografisch Selten V', 'Holografisch Selten VMAX', 'Holografisch Selten VSTAR', 'Hyperselten', 'Häufig', 'Keine', 'LEGENDE', 'Mega Hyper Selten', 'Pikachu Rare', 'Promo', 'Schwarz-Weiß Selten', 'Selten', 'Selten, Holografisch', 'Selten, Holografisch LV.X', 'Selten, Illustration', 'Selten, Strahlend', 'Selten, besondere Illustration', 'Shiny rare', 'Shiny rare V', 'Shiny rare VMAX', 'Ultra Selten', 'Ungewöhnlich', 'Versteckt Selten', 'Vollkunsttrainer', 'selten, Primus', 'ultraselten, Schillernd'],
    category: ['Energie', 'Pokémon', 'Trainer'],
    stage: ['Baby', 'Basis', 'Erweckt', 'Level Up', 'MEGA', 'Rang 1', 'Rang 2', 'TURBO', 'V-UNION', 'VMAX', 'VSTAR'],
    types: ['Drache', 'Elektro', 'Farblos', 'Fee', 'Feuer', 'Kampf', 'Metall', 'Pflanze', 'Psycho', 'Unlicht', 'Wasser']
  },
  it: {
    rarity: ["Allenatore d'arte completa", 'Comune', 'Futuristic Rare', 'Mega Iper Raro', 'Nessuna', 'Non comune', 'Olografica Rara', 'Olografica Rara V', 'Olografica Rara VMAX', 'Olografica Rara VSTAR', 'Pikachu Rare', 'Policrome', 'Promo', 'Rara', 'Rara Bianco e Nero', 'Rara Lucente', 'Rara doppia', 'Rara illustrazione', 'Rara illustrazione speciale', 'Rara iper', 'Segreto rara', 'Shiny rare', 'Shiny rare V', 'Shiny rare VMAX', 'Ultrarara', 'rara ASSO TATTICO', 'ultrarara cromatica'],
    category: ['Allenatore', 'Energia', 'Pokémon'],
    stage: ['Base', 'Livello 1', 'Livello 2', 'MEGA', 'Ricreato', 'TURBO', 'V ASTRO', 'V UNIONE', 'VMAX'],
    types: ['Acqua', 'Drago', 'Erba', 'Folletto', 'Fuoco', 'Incolore', 'Lampo', 'Lotta', 'Metallo', 'Oscurità', 'Psico']
  },
  es: {
    rarity: ['Común', 'Entrenador de arte completo', 'Futuristic Rare', 'Holo Rara', 'Holo Rara V', 'Holo Rara VMAX', 'Holo Rara VSTAR', 'Increíbles', 'Mega Hiper Rara', 'Ninguno', 'Pikachu Rare', 'Promo', 'Rara', 'Rara AS TÁCTICO', 'Rara Blanca y Negra', 'Rara Doble', 'Rara Híper', 'Rara Ilustración', 'Rara Ilustración Especial', 'Rara Radiante', 'Rara Secreta', 'Rara Ultra Variocolor', 'Shiny rare', 'Shiny rare V', 'Shiny rare VMAX', 'Ultra Rara', 'Uncommon'],
    category: ['Energía', 'Entrenador', 'Pokémon'],
    stage: ['Básico', 'Fase 1', 'Fase 2', 'MEGA', 'RECREADO', 'TURBO', 'V-ASTRO', 'V-UNIÓN', 'VMAX'],
    types: ['Agua', 'Dragón', 'Fuego', 'Hada', 'Incolora', 'Lucha', 'Metálica', 'Oscura', 'Planta', 'Psíquico', 'Rayo']
  }
}

describe('europeanCard', () => {
  it('maps a French card to the English vocabulary', () => {
    const c = europeanCard('fr', CHARIZARD_FR)
    expect(c).toMatchObject({
      name: 'Dracaufeu-ex',
      category: 'Pokemon',
      rarity: 'Double rare',
      types: ['Darkness'],
      stage: 'Stage2'
    })
  })

  it('keeps no TCGplayer id: these printings have no product or price', () => {
    const c = europeanCard('fr', CHARIZARD_FR)
    expect(c.thirdParty).toBeUndefined()
    expect(c.variants_detailed?.[0].thirdParty).toBeUndefined()
  })

  it('reads a language with no rarity as none, like Traditional Chinese', () => {
    expect(europeanCard('fr', card('2013bw-1', 'Phyllali', { rarity: 'Sans Rareté' })).rarity).toBeNull()
    expect(europeanCard('de', card('x-1', 'Evoli', { rarity: 'Keine' })).rarity).toBeNull()
    expect(europeanCard('fr', card('x-1', 'Évoli')).rarity).toBeUndefined()
  })

  it('tells the two French rarities that nearly read alike apart', () => {
    expect(europeanCard('fr', card('x-1', 'a', { rarity: 'Magnifique' })).rarity).toBe('Amazing Rare')
    expect(europeanCard('fr', card('x-1', 'a', { rarity: 'Magnifique rare' })).rarity).toBe('Secret Rare')
  })

  it.each([
    ['rarity', { rarity: 'Rarissime' }, 'Rarissime'],
    ['category', { category: 'Objet' }, 'Objet'],
    ['stage', { stage: 'Niveau 3' }, 'Niveau 3'],
    ['type', { types: ['Bois'] }, 'Bois'],
    ['variant type', { variants_detailed: [{ type: 'Brillant' }] }, 'Brillant'],
    ['stamp', { variants_detailed: [{ type: 'Holo', stamp: ['Tampon Inconnu'] }] }, 'Tampon Inconnu'],
    ['subtype', { variants_detailed: [{ type: 'Holo', subtype: 'bord vert' }] }, 'bord vert']
  ] as [string, Partial<TdCard>, string][])('stops on an unmapped %s, naming it', (_kind, extra, value) => {
    expect(() => europeanCard('fr', card('sv03-1', 'a', extra))).toThrow(value)
  })

  it('stops on a Pocket rarity on a paper card, and on a rarity not yet decided for foil', () => {
    expect(() => europeanCard('fr', card('sv03-1', 'a', { rarity: 'Couronne' }))).toThrow('Couronne')
    expect(() => europeanCard('fr', card('sv03-1', 'a', { rarity: 'Mega Attack Rare' }))).toThrow(
      'Mega Attack Rare'
    )
  })

  it('leaves the printed text alone', () => {
    const c = europeanCard('fr', {
      ...CHARIZARD_FR,
      attacks: [{ cost: ['Feu'], name: 'Obscurité Brûlante', damage: '180+' }]
    })
    expect(c.attacks?.[0]).toEqual({ cost: ['Feu'], name: 'Obscurité Brûlante', damage: '180+' })
  })
})

describe('variants', () => {
  /** The version labels with no products, the way these cards always are. */
  const labels = (c: TdCard): string[] =>
    cardVersions(c, [], new Map()).versions.map((v) => v.label)

  it('gives a French card the English labels, which are part of the key', () => {
    const fr = card('base1-4', 'Dracaufeu', {
      rarity: 'Rare Holo',
      variants_detailed: [
        { type: 'Holo', subtype: 'illimité' },
        { type: 'Holo', stamp: ['1re Édition'] },
        { type: 'Holo', subtype: 'sans ombre' },
        { type: 'Holo', subtype: 'sans ombre', stamp: ['1re Édition'] }
      ]
    })
    const en = card('base1-4', 'Charizard', {
      rarity: 'Rare Holo',
      variants_detailed: [
        { type: 'holo', subtype: 'unlimited' },
        { type: 'holo', stamp: ['1st-edition'] },
        { type: 'holo', subtype: 'shadowless' },
        { type: 'holo', subtype: 'shadowless', stamp: ['1st-edition'] }
      ]
    })
    expect(labels(europeanCard('fr', fr))).toEqual(labels(en))
    expect(labels(en)).toEqual([
      '1st Edition Holofoil',
      'Holofoil',
      'Shadowless 1st Edition Holofoil',
      'Shadowless Holofoil'
    ])
  })

  it('reads the Italian and Spanish words for a plain, holo and reverse printing', () => {
    const it_ = card('sv01-1', 'a', {
      variants_detailed: [{ type: 'Normale' }, { type: 'Olografica' }, { type: 'Reverse' }]
    })
    const es = card('sv01-1', 'a', {
      variants_detailed: [{ type: 'básico' }, { type: 'holo' }, { type: 'reversa' }]
    })
    const want = ['Holofoil', 'Normal', 'Reverse Holofoil']
    expect(labels(europeanCard('it', it_))).toEqual(want)
    expect(labels(europeanCard('es', es))).toEqual(want)
  })

  it("keeps TCGdex's generated variants, which it leaves in English", () => {
    const c = europeanCard('fr', card('bw1-1', 'a', { variants_detailed: [{ type: 'normal', variantId: 'generated' }] }))
    expect(c.variants_detailed?.[0]).toEqual({ type: 'normal', variantId: 'generated' })
  })

  it("reads a generated Normal of an always-foil rarity as foil, once the rarity is English", () => {
    const fr = europeanCard(
      'fr',
      card('swsh1-1', 'a', { rarity: 'Holo Rare V', variants_detailed: [{ type: 'normal', variantId: 'generated' }] })
    )
    expect(labels(fr)).toEqual(['Holofoil'])
    const de = europeanCard(
      'de',
      card('swsh1-1', 'a', { rarity: 'Holografisch Selten V', variants_detailed: [{ type: 'normal', variantId: 'generated' }] })
    )
    expect(labels(de)).toEqual(['Holofoil'])
  })

  it('finds a cosmos foil in every spelling', () => {
    for (const [lang, foil] of [['fr', 'Cosmos'], ['de', 'Kosmos'], ['it', 'Cosmo']] as const) {
      const c = europeanCard(lang, card('x-1', 'a', { variants_detailed: [{ type: 'Reverse', foil }] }))
      expect(c.variants_detailed?.[0].foil).toBe('cosmos')
    }
  })

  it('leaves out a stamped variant, which may never have been printed in this language', () => {
    const c = europeanCard(
      'fr',
      card('x-1', 'a', {
        variants_detailed: [{ type: 'Holo' }, { type: 'Holo', stamp: ['worlds-2025'] }]
      })
    )
    expect(c.variants_detailed).toEqual([expect.objectContaining({ type: 'holo' })])
  })

  it('keeps a 1st Edition variant', () => {
    const c = europeanCard('fr', card('x-1', 'a', { variants_detailed: [{ type: 'Holo', stamp: ['1re Édition'] }] }))
    expect(c.variants_detailed?.[0].stamp).toEqual(['1st-edition'])
  })
})

describe('the vocabulary tables', () => {
  it.each(EUROPEAN_LANGS)("%s: every live value maps into the English lists", (lang) => {
    const live = LIVE[lang]
    for (const value of live.rarity) {
      const c = europeanCard(lang, card('x-1', 'a', { rarity: value }))
      if (c.rarity !== null) expect(ENGLISH_VOCAB.rarity).toContain(c.rarity)
    }
    for (const value of live.category)
      expect(ENGLISH_VOCAB.category).toContain(europeanCard(lang, card('x-1', 'a', { category: value })).category)
    for (const value of live.stage)
      expect(ENGLISH_VOCAB.stage).toContain(europeanCard(lang, card('x-1', 'a', { stage: value })).stage)
    expect(new Set(europeanCard(lang, card('x-1', 'a', { types: live.types })).types)).toEqual(
      new Set(ENGLISH_VOCAB.types)
    )
  })

  it('every table maps only to English values', () => {
    for (const lang of EUROPEAN_LANGS) {
      for (const [kind, table] of Object.entries(LOCAL_VOCAB[lang])) {
        const english = new Set(ENGLISH_VOCAB[kind as keyof typeof ENGLISH_VOCAB])
        for (const value of Object.values(table)) expect(english.has(value)).toBe(true)
      }
    }
  })

  it('sends each language to the always-foil rarities versions.ts expects', () => {
    const foil = { fr: 'Illustration spéciale rare', de: 'Selten, besondere Illustration', it: 'Rara illustrazione speciale', es: 'Rara Ilustración Especial' }
    for (const lang of EUROPEAN_LANGS)
      expect(alwaysFoil(europeanCard(lang, card('x-1', 'a', { rarity: foil[lang] })).rarity)).toBe(true)
  })
})

describe('europeanCards', () => {
  it('names every unmapped value at once, not just the first', () => {
    expect(() =>
      europeanCards('fr', [card('a-1', 'a', { rarity: 'Inconnue' }), card('a-2', 'b', { stage: 'Niveau 9' })])
    ).toThrow(/Inconnue[\s\S]*Niveau 9/)
  })
})

describe('europeanNamer', () => {
  const en = [
    CHARIZARD_EN,
    card('sm1-1', 'Eevee', { category: 'Pokemon', dexId: [133] }),
    card('sm2-1', 'Eevee', { category: 'Pokemon', dexId: [133] })
  ]
  const fr = [
    europeanCard('fr', CHARIZARD_FR),
    europeanCard('fr', card('sm1-1', 'Évoli', { category: 'Pokémon', dexId: [133] })),
    europeanCard('fr', card('sm2-1', 'Évoli', { category: 'Pokémon', dexId: [133] })),
    europeanCard('fr', card('2018sm-fr-40', 'Évoli', { category: 'Pokémon', dexId: [133] })),
    europeanCard('fr', card('2019sm-fr-1', 'Inconnu', { category: 'Pokémon', dexId: [201] })),
    europeanCard('fr', card('2013bw-1', 'Évoli', { category: 'Dresseur' }))
  ]
  const namer = europeanNamer(fr, en)

  it('names a card from the same-id English card', () => {
    expect(namer.nameOf(fr[0])).toBe('Charizard ex')
  })
  it('names a card of a set English lacks from the other cards of its name', () => {
    expect(namer.nameOf(fr[3])).toBe('Eevee')
  })
  it('leaves a card nothing names, and never crosses a category', () => {
    expect(namer.nameOf(fr[4])).toBeNull()
    expect(namer.nameOf(fr[5])).toBeNull()
  })
  it('takes no name from a same-id card that is another card', () => {
    const odd = europeanCard('fr', card('sv03-125', 'Évoli', { category: 'Pokémon', dexId: [133] }))
    expect(europeanNamer([odd], en).nameOf(odd)).toBeNull()
  })
})

describe('europeanCardIsUsable', () => {
  const DAY = 24 * 60 * 60 * 1000
  it('is fresh for at least the usual week and never more than two', () => {
    for (const id of ['sv03-1', 'sv03-2', 'base1-4', 'swshp-SWSH001']) {
      expect(europeanCardIsUsable(id, 0, CARD_MAX_AGE_MS)).toBe(true)
      expect(europeanCardIsUsable(id, 0, 2 * CARD_MAX_AGE_MS)).toBe(false)
    }
  })
  it('spreads one fill across the nights of a week', () => {
    const due = Array.from({ length: 7 }, () => 0)
    const ids = Array.from({ length: 700 }, (_, i) => `sv03-${i}`)
    for (const id of ids) {
      const night = Array.from({ length: 8 }, (_, n) => n).find(
        (n) => !europeanCardIsUsable(id, 0, CARD_MAX_AGE_MS + (n + 1) * DAY)
      )!
      due[night]++
    }
    for (const n of due) {
      expect(n).toBeGreaterThan(60)
      expect(n).toBeLessThan(140)
    }
  })
})

const fullSet = (id: string, name: string, cards: TdCard[], extra: Partial<TdSet> = {}): TdSet => ({
  id,
  name,
  cards: cards.map((c) => ({ id: c.id, localId: c.localId, name: c.name })),
  ...extra
})

describe('the writer', () => {
  const ENERGY_FR = card('sv03-230', 'Énergie Métal', {
    category: 'Énergie',
    rarity: 'Commune',
    variants_detailed: [{ type: 'normal', variantId: 'generated' }]
  })
  const OBF_FR = fullSet('sv03', 'Flammes Obsidiennes', [CHARIZARD_FR, ENERGY_FR], {
    abbreviation: { official: 'OBF', localized: 'FLO' } as TdSet['abbreviation'],
    cardCount: { official: 197, total: 230 },
    releaseDate: '2023-08-11',
    logo: 'https://assets.tcgdex.net/fr/sv/sv03/logo'
  })
  const OBF_EN = fullSet('sv03', 'Obsidian Flames', [CHARIZARD_EN], {
    abbreviation: { official: 'OBF' },
    cardCount: { official: 197, total: 230 }
  })
  const ONLY_FR = fullSet('2018sm-fr', 'Collection McDonald\'s 2018', [
    card('2018sm-fr-6', 'Dracaufeu-ex', { category: 'Pokémon', rarity: 'Sans Rareté', dexId: [6] })
  ])

  const sources = (over: Partial<PokemonSources> = {}): PokemonSources => ({
    async sets(lang) {
      if (lang === 'en') return [OBF_EN]
      return lang === 'fr' ? [OBF_FR, ONLY_FR] : []
    },
    async cards(lang) {
      if (lang === 'en') return [CHARIZARD_EN]
      return lang === 'fr'
        ? europeanCards('fr', [CHARIZARD_FR, ENERGY_FR, ...ONLY_FR.cards.map((b) => card(b.id, b.name, { category: 'Pokémon', rarity: 'Sans Rareté', dexId: [6] }))])
        : []
    },
    groups: async () => [],
    products: async () => [],
    prices: async () => [],
    ...over
  })
  let db: ReturnType<typeof openDatabase>
  beforeEach(() => {
    db = openDatabase(':memory:')
  })
  afterEach(() => db.close())

  const one = <T>(sql: string, ...args: unknown[]): T => db.prepare(sql).get(...args) as T

  it('writes the printed set name, the official code and no price', async () => {
    await refreshPokemon(db, sources(), { langs: ['en', 'fr'] })
    expect(one("SELECT set_name, set_code FROM sets WHERE game = 'pkm' AND language = 'fr' AND set_code = 'OBF'")).toEqual({
      set_name: 'Flammes Obsidiennes',
      set_code: 'OBF'
    })
    const id = pokemonId('fr/sv03-125')
    expect(
      one('SELECT set_name, set_code, set_rarity, language, tcg_product_id, market_price FROM card_printings WHERE card_id = ?', id)
    ).toEqual({
      set_name: 'Flammes Obsidiennes',
      set_code: 'OBF 125/197',
      set_rarity: 'Holofoil',
      language: 'fr',
      tcg_product_id: null,
      market_price: null
    })
  })

  it('names a card in English, keeping the printed name', async () => {
    await refreshPokemon(db, sources(), { langs: ['en', 'fr'] })
    const id = pokemonId('fr/sv03-125')
    expect(one('SELECT name FROM cards WHERE id = ?', id)).toEqual({ name: 'Charizard ex' })
    expect(
      one('SELECT local_name, category, rarity, stage, types FROM pokemon_cards WHERE card_id = ?', id)
    ).toEqual({
      local_name: 'Dracaufeu-ex',
      category: 'Pokemon',
      rarity: 'Double rare',
      stage: 'Stage2',
      types: '["Darkness"]'
    })
  })

  it('keeps the local name as the name when English has no card of it', async () => {
    await refreshPokemon(db, sources(), { langs: ['en', 'fr'] })
    const id = pokemonId('fr/sv03-230')
    expect(one('SELECT name FROM cards WHERE id = ?', id)).toEqual({ name: 'Énergie Métal' })
    expect(one('SELECT local_name FROM pokemon_cards WHERE card_id = ?', id)).toEqual({ local_name: null })
  })

  it('names a French-only set from the same name elsewhere, with the id as its code', async () => {
    await refreshPokemon(db, sources(), { langs: ['en', 'fr'] })
    const id = pokemonId('fr/2018sm-fr-6')
    expect(one('SELECT name FROM cards WHERE id = ?', id)).toEqual({ name: 'Charizard ex' })
    expect(one('SELECT set_code FROM card_printings WHERE card_id = ?', id)).toEqual({ set_code: '2018SM-FR 6' })
  })

  it('keeps a card without art on no art, never the English image', async () => {
    await refreshPokemon(db, sources(), { langs: ['en', 'fr'] })
    expect(one('SELECT image_url, art_twin_id FROM pokemon_cards WHERE card_id = ?', pokemonId('fr/sv03-230'))).toEqual({
      image_url: null,
      art_twin_id: null
    })
  })

  it('stays on the frozen names when TCGdex renames a set', async () => {
    await refreshPokemon(db, sources(), { langs: ['en', 'fr'] })
    OBF_FR.name = 'Flammes Obscures'
    try {
      await refreshPokemon(db, sources(), { langs: ['en', 'fr'] })
    } finally {
      OBF_FR.name = 'Flammes Obsidiennes'
    }
    expect(one("SELECT COUNT(*) AS n FROM sets WHERE language = 'fr' AND set_name = 'Flammes Obscures'")).toEqual({ n: 0 })
  })

  it('drops only a failing European language, and logs it', async () => {
    const lines: string[] = []
    const reports = await refreshPokemon(
      db,
      sources({
        cards: async (lang) => {
          if (lang === 'fr') throw new Error('Unmapped fr rarity "Rarissime"')
          return [CHARIZARD_EN]
        }
      }),
      { langs: ['en', 'fr'], log: (l) => lines.push(l) }
    )
    expect(reports.map((r) => r.lang)).toEqual(['en'])
    expect(lines.some((l) => l.includes('fr') && l.includes('Rarissime'))).toBe(true)
    expect(one("SELECT COUNT(*) AS n FROM card_printings WHERE language = 'en'")).toEqual({ n: 1 })
    expect(one("SELECT COUNT(*) AS n FROM card_printings WHERE language = 'fr'")).toEqual({ n: 0 })
  })

  it("flags nothing of a language dropped after an earlier night wrote it", async () => {
    await refreshPokemon(db, sources(), { langs: ['en', 'fr'] })
    await refreshPokemon(db, sources({ sets: async (lang) => {
      if (lang === 'fr') throw new Error('GET /fr/sets returned 503')
      return [OBF_EN]
    } }), { langs: ['en', 'fr'] })
    expect(one("SELECT COUNT(*) AS n FROM card_printings WHERE language = 'fr' AND missing_from_api = 1")).toEqual({ n: 0 })
  })

  it('still fails the night for an English failure', async () => {
    const out = await runPokemonStep(db, {
      cachePath: ':memory:',
      version: '9.9.9',
      log: () => {},
      sources: sources({ sets: async () => { throw new Error('down') } })
    })
    expect(out.error).toBe('down')
  })

  it('switches French on, and only French, in the nightly list', async () => {
    const asked: PkmLang[] = []
    const out = await runPokemonStep(db, {
      cachePath: ':memory:',
      version: '9.9.9',
      log: () => {},
      sources: sources({ sets: async (lang) => { asked.push(lang); return [] } })
    })
    expect(out.error).toBeNull()
    expect(asked).toEqual(['en', 'ja', 'zh-hans', 'zh-hant', 'fr'])
  })
})

describe('the scanner', () => {
  it('keeps to English and Japanese with a European set picked, so no row loses its printings', () => {
    expect(isPokemonLanguage('fr')).toBe(false)
    expect(liveLanguage({ set: { setName: 'Flammes Obsidiennes', language: 'fr' }, scanLanguage: 'ja' })).toBe('ja')
  })
})

describe('createPokemonSources', () => {
  const json = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pkm-eu-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  const LIVE_SET = {
    id: 'sv03',
    name: 'Flammes Obsidiennes',
    serie: { id: 'sv' },
    cards: [{ id: 'sv03-125', localId: '125', name: 'Dracaufeu-ex' }]
  }
  const POCKET = { id: 'A1', name: 'Puissance Génétique', serie: { id: 'tcgp' }, cards: [{ id: 'A1-001', localId: '001', name: 'x' }] }
  const EMPTY = { id: 'empty', name: 'Rien', serie: { id: 'sv' }, cards: [] }

  function sources(routes: Record<string, unknown>, status: Record<string, number> = {}) {
    const calls: string[] = []
    const live = createPokemonSources({
      cachePath: join(dir, 'src.sqlite'),
      version: '9.9.9',
      retryDelayMs: 1,
      now: () => new Date('2026-11-01T00:00:00Z'),
      fetch: (async (input: RequestInfo | URL) => {
        const url = String(input)
        calls.push(url)
        const key = Object.keys(routes).find((k) => url.endsWith(k))
        const failing = Object.keys(status).find((k) => url.endsWith(k))
        if (failing) return json({}, status[failing])
        return key ? json(routes[key]) : json({}, 404)
      }) as typeof fetch
    })
    return { live, calls }
  }

  it('reads the language from TCGdex without Pocket, empty sets or TCGCSV', async () => {
    const { live, calls } = sources({
      '/fr/sets': [{ id: 'sv03' }, { id: 'A1' }, { id: 'empty' }],
      '/fr/sets/sv03': LIVE_SET,
      '/fr/sets/A1': POCKET,
      '/fr/sets/empty': EMPTY
    })
    const sets = await live.sets('fr')
    live.close()
    expect(sets.map((s) => s.id)).toEqual(['sv03'])
    expect(calls.every((u) => u.startsWith('https://api.tcgdex.net/v2/fr/'))).toBe(true)
  })

  it('has no TCGCSV groups, products or prices', async () => {
    const { live, calls } = sources({})
    expect(await live.groups('fr')).toEqual([])
    expect(await live.products('fr', 1)).toEqual([])
    expect(await live.prices('fr', 1)).toEqual([])
    live.close()
    expect(calls).toEqual([])
  })

  it('normalises a card, and keeps a fresh one with no art or product from the cache', async () => {
    const raw = { ...CHARIZARD_FR, image: undefined, thirdParty: undefined, variants_detailed: [{ type: 'Holo' }] }
    const { live, calls } = sources({ '/fr/cards/sv03-125': raw })
    const [first] = await live.cards('fr', ['sv03-125'])
    const [second] = await live.cards('fr', ['sv03-125'])
    live.close()
    expect(first.category).toBe('Pokemon')
    expect(second).toEqual(first)
    expect(calls).toHaveLength(1)
  })

  it('keeps the fetched cards in the cache when a value stops the language', async () => {
    const bad = { ...CHARIZARD_FR, rarity: 'Rarissime' }
    const { live, calls } = sources({ '/fr/cards/sv03-125': bad })
    await expect(live.cards('fr', ['sv03-125'])).rejects.toThrow('Rarissime')
    await expect(live.cards('fr', ['sv03-125'])).rejects.toThrow('Rarissime')
    live.close()
    expect(calls).toHaveLength(1)
  })

  it('fails on a card TCGdex keeps refusing, stopping what is queued', async () => {
    const { live } = sources({ '/fr/cards/sv03-2': CHARIZARD_FR }, { '/fr/cards/sv03-1': 503 })
    await expect(live.cards('fr', ['sv03-1', 'sv03-2'])).rejects.toThrow('503')
    live.close()
  })
})
