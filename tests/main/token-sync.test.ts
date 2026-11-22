import type Database from 'better-sqlite3'
import { getMeta, setMeta } from '../../src/main/db/meta'
import { browseCards } from '../../src/main/repo/browse'
import { printingsByCode } from '../../src/main/repo/scan'
import { refreshIntlSets } from '../../src/main/sync/intl'
import { runSync } from '../../src/main/sync/sync'
import { cardKind, refreshTokens, shouldRefreshTokens } from '../../src/main/sync/tokens'
import { saveTcgVariants } from '../../src/main/tcgplayer/catalog'
import type { YugipediaClient } from '../../src/main/yugipedia/client'
import { parseGalleryCodes, parseTokenPage } from '../../src/main/yugipedia/parse'
import { choosePrintingFile, fileArtName } from '../../src/main/yugipedia/printingArt'
import type { YgoClient } from '../../src/main/ygo/client'
import type { ApiCard } from '../../src/main/ygo/mapCard'
import { gameOfId, isTokenId, PKM_ID_MIN, TOKEN_ID_MAX, tokenId } from '../../src/shared/games/ids'
import fixture from '../fixtures/cardinfo.sample.json'
import { seededDb } from './helpers'

const NASH = 'Token (Nash and "Number C101: Silent Honor DARK")'
const NASH_FILE = 'Token-TKN5-EN-SR-1E-NashandNumberC101SilentHonorDARK.png'
const NASH_PAGE = `{{CardTable2
| ja_name     = トークン
| image       = ${NASH_FILE}
| card_type   = Token
| text        = This [[Reginald Kastle|Nash]] & [[Number C101: Silent Honor DARK]] card can be used as any [[Monster Token|Token]].<br /><br />''"Behold!"''
| en_sets     =
TKN5-EN055; Beyond the Brave; Super Rare
| jp_sets     =
TK02-JP014; Token Pack Vol.2; Rare, Ultra Rare
}}`
const YUSEI_PAGE = `{{CardTable2
| image         =
1; Token-VF16-JP-C-YuseiStardustDragon.png
2; Token-QCDB-JP-SR-YuseiandStardustDragon.png
| current_image = 2
| card_type     = Token
| jp_sets       =
VF16-JPP02; Jump Victory Carnival 2016 - Promotion Pack; Common
}}`
const VASSAL_PAGE = `{{CardTable2
| image       = Token-TKN4-EN-SR-UE-Vassal.png
| attribute   = LIGHT
| types       = Thunder / Normal
| level       = 1
| atk         = 800
| def         = 1000
| en_sets     =
TKN4-EN027; Yu-Gi-Oh! Day January 2016 promotional card; Super Rare
| archseries  = Vassal
}}`
const GENERIC_PAGE = `{{CardTable2
| image       = Token-L5DD-EN-ScR-1E-Yusei.png
| types       = Normal
| en_sets     =
TKN4-EN008; Duelist League promotional cards; Super Rare
TKN4-EN027; Yu-Gi-Oh! Day January 2016 promotional card; Super Rare
; Official Tournament Store Program promotional card; Common
| jp_sets     =
TKN-JP001; Token Pack; Common
}}`
const GENERIC_GALLERY = `<gallery widths="175px">
Token-TKN4-EN-OP-OjamaYellow.png | [[TKN4-EN008]] ([[OP]])
Token-TKN4-EN-SR-UE-OjamaYellow.png | [[TKN4-EN008]] ([[SR]])
</gallery>`
const ANIME_PAGE = `{{CardTable2\n| image = X.png\n| card_type = Token\n}}`

const CARD_PAGES: Record<string, { pageId: number; text: string }> = {
  'Token (card)': { pageId: 50, text: GENERIC_PAGE },
  [NASH]: { pageId: 1200, text: NASH_PAGE },
  'Token (Yusei and Stardust Dragon)': { pageId: 1300, text: YUSEI_PAGE },
  'Vassal Token': { pageId: 900, text: VASSAL_PAGE },
  'Cynet Token': { pageId: 910, text: ANIME_PAGE }
}
const BLS = 'Black Luster Soldier (Normal)'
const BLS_FILE = 'BlackLusterSoldier-25TH-EN-UR-LE.png'
const BLS_PAGE = `{{CardTable2
| ja_name               = カオス・ソルジャー
| image                 = ${BLS_FILE}
| attribute             = EARTH
| types                 = Warrior / Normal
| level                 = 8
| atk                   = 3000
| def                   = 2500
| password              = none
| text                  = ''The mightiest [[warrior]], whose abilities equal the [[Blue-Eyes White Dragon]].''
| en_sets               =
25TH-EN001; Legendary Collection 25th Anniversary Edition; Ultra Rare
| jp_sets               =
YAC1-JP026; Original Artwork Collection; Super Rare, Secret Rare, Ultimate Rare
}}`
const STARDUST_PAGE = `{{CardTable2
| image       = StardustDivinity-EN.png
| types       = Fairy / Synchro / Tuner / Effect
| level       = 10
| en_sets     =
SDDV-EN001; Stardust Divinity promo; Secret Rare
}}`
const COUNTER_PAGE = `{{CardTable2
| image       = Counter-JP.png
| card_type   = Counter
| jp_sets     =
CNT-JP001; Counters; Common
}}`
const RUSH_PAGE = `{{CardTable2
| main        = Card Destruction
| rush_duel   = yes
| image       = CardDestruction-WWRP-JP-C.png
| card_type   = Spell
| property    = Normal
| jp_sets     =
WWRP-JP001; Wai Wai Rush Party; Common
}}`
/** A passcode-less page whose card YGOPRODeck lists under the same name. */
const LISTED_PAGE = `{{CardTable2
| image       = DarkMagician-PROMO-EN.png
| types       = Spellcaster / Normal
| en_sets     =
DMPR-EN001; Dark Magician promo; Ultra Rare
}}`
const NO_PASSWORD_PAGES: Record<string, { pageId: number; text: string }> = {
  [BLS]: { pageId: 2000, text: BLS_PAGE },
  'Stardust Divinity': { pageId: 2010, text: STARDUST_PAGE },
  'Counter (card)': { pageId: 2020, text: COUNTER_PAGE },
  'Card Destruction (Wai Wai Rush Party)': { pageId: 2030, text: RUSH_PAGE },
  'Dark Magician': { pageId: 2040, text: LISTED_PAGE },
  'Darkness/Monster A': {
    pageId: 2050,
    text: `{{CardTable2\n| image = DarknessMonsterA.png\n| types = Effect\n| jp_sets =\nDP-JP001; Darkness pack; Common\n}}`
  },
  // A token is in both categories; the token category has it.
  [NASH]: { pageId: 1200, text: NASH_PAGE }
}

const FILE_PAGES: Record<string, number> = {
  [BLS_FILE]: 8000,
  'StardustDivinity-EN.png': 8010,
  'Counter-JP.png': 8020,
  'CardDestruction-WWRP-JP-C.png': 8030,
  'DarkMagician-PROMO-EN.png': 8040,
  'DarknessMonsterA.png': 8050,
  [NASH_FILE]: 7000,
  'Token-VF16-JP-C-YuseiStardustDragon.png': 7100,
  'Token-L5DD-EN-ScR-1E-Yusei.png': 7200
}

function fake(over: Partial<YugipediaClient> = {}): YugipediaClient {
  return {
    listSetListTitles: async () => [],
    fetchImageUrls: async () => new Map(),
    listPageImages: async () => new Map(),
    imageUrlsByPageId: async () => new Map(),
    listCategoryPages: async (category) =>
      Object.entries(
        category === 'Category:Cards printed without a password' ? NO_PASSWORD_PAGES : CARD_PAGES
      ).map(([title, p]) => ({ title, pageId: p.pageId })),
    fetchPages: async (titles) =>
      new Map(
        titles.flatMap((t): [string, string][] => {
          if (t === 'Card Gallery:Token (card)') return [[t, GENERIC_GALLERY]]
          const page = CARD_PAGES[t] ?? NO_PASSWORD_PAGES[t]
          return page ? [[t, page.text]] : []
        })
      ),
    filePageIds: async (files) =>
      new Map(files.filter((f) => FILE_PAGES[f]).map((f) => [f, FILE_PAGES[f]])),
    ...over
  }
}

let db: Database.Database
const now = new Date('2026-10-30T12:00:00.000Z')
const printings = (
  cardId: number
): { set_code: string; set_rarity: string; set_name: string; variant: string | null }[] =>
  db
    .prepare(
      'SELECT set_code, set_rarity, set_name, variant FROM card_printings WHERE card_id = ? ORDER BY set_code'
    )
    .all(cardId) as never

beforeEach(async () => {
  db = await seededDb()
  db.prepare(
    `INSERT INTO cards (id, name, type, frame_type, race, "desc", updated_at)
     VALUES (22404676, 'Vassal Token', 'Token', 'token', 'Thunder', '', '2026-10-23')`
  ).run()
  db.prepare(
    'INSERT INTO card_images (image_id, card_id, sort_order) VALUES (22404676, 22404676, 0)'
  ).run()
})
afterEach(() => db.close())

describe('token ids', () => {
  test('are Yu-Gi-Oh ids that fit a format 1 fingerprint file and below 2^31', () => {
    const id = tokenId(1_234_836)
    expect(gameOfId(id)).toBe('ygo')
    expect(isTokenId(id)).toBe(true)
    expect(isTokenId(501_000_007)).toBe(false)
    expect(isTokenId(PKM_ID_MIN)).toBe(false)
    expect(TOKEN_ID_MAX).toBeLessThanOrEqual(2 ** 31)
    expect(tokenId(1_234_836)).toBe(2_001_234_836)
  })
})

describe('parseTokenPage', () => {
  test('reads a character token', () => {
    expect(parseTokenPage(NASH_PAGE)).toMatchObject({
      image: NASH_FILE,
      text: 'This Nash & Number C101: Silent Honor DARK card can be used as any Token.\n\n"Behold!"',
      printings: [{ code: 'TKN5-EN055', setName: 'Beyond the Brave', rarity: 'Super Rare' }],
      printed: true
    })
  })

  test('reads a list of images, stats and types', () => {
    expect(parseTokenPage(YUSEI_PAGE)).toMatchObject({
      image: 'Token-VF16-JP-C-YuseiStardustDragon.png',
      printings: [],
      printed: true
    })
    expect(parseTokenPage(VASSAL_PAGE)).toMatchObject({
      race: 'Thunder',
      attribute: 'LIGHT',
      level: 1,
      atk: 800,
      def: 1000,
      archetype: 'Vassal'
    })
  })

  test('reads what kind of card a page is', () => {
    expect(parseTokenPage(BLS_PAGE)).toMatchObject({
      cardType: null,
      types: ['Warrior', 'Normal'],
      level: 8,
      rush: false,
      printings: [
        {
          code: '25TH-EN001',
          setName: 'Legendary Collection 25th Anniversary Edition',
          rarity: 'Ultra Rare'
        }
      ]
    })
    expect(parseTokenPage(RUSH_PAGE)).toMatchObject({ cardType: 'Spell', rush: true })
    expect(
      parseTokenPage(`{{CardTable2\n| types = Dragon / Effect\n| requirement = None\n}}`)?.rush
    ).toBe(true)
    expect(
      parseTokenPage(
        `{{CardTable2\n| types = Dragon / Link / Effect\n| link_arrows = Top, Bottom-Left, Bottom-Right\n}}`
      )?.linkArrows
    ).toBe(3)
  })

  test('tells an unprinted token and a page with no card table', () => {
    expect(parseTokenPage(ANIME_PAGE)?.printed).toBe(false)
    expect(parseTokenPage('Just a list of tokens.')).toBeNull()
  })
})

describe('cardKind', () => {
  const page = (text: string): NonNullable<ReturnType<typeof parseTokenPage>> =>
    parseTokenPage(`{{CardTable2\n${text}\n}}`)!

  test('stores a token as a token, from either category', () => {
    expect(cardKind(parseTokenPage(VASSAL_PAGE)!, true)).toMatchObject({
      type: 'Token',
      frameType: 'token',
      race: 'Thunder'
    })
  })

  test('names a monster in YGOPRODeck words', () => {
    expect(cardKind(parseTokenPage(BLS_PAGE)!, false)).toEqual({
      type: 'Normal Monster',
      frameType: 'normal',
      race: 'Warrior',
      level: 8,
      linkval: null
    })
    expect(cardKind(parseTokenPage(STARDUST_PAGE)!, false)).toMatchObject({
      type: 'Synchro Tuner Monster',
      frameType: 'synchro',
      race: 'Fairy'
    })
    expect(
      cardKind(page('| types = Dragon / Link / Effect\n| link_arrows = Top, Bottom'), false)
    ).toMatchObject({ type: 'Link Monster', frameType: 'link', linkval: 2 })
    expect(cardKind(page('| types = Warrior / Xyz / Effect\n| rank = 4'), false)).toMatchObject({
      type: 'XYZ Monster',
      frameType: 'xyz',
      level: 4
    })
    expect(cardKind(page('| types = Spellcaster / Pendulum / Effect'), false)).toMatchObject({
      type: 'Pendulum Effect Monster',
      frameType: 'effect_pendulum'
    })
    // The original Egyptian Gods name only their Type; Darkness's cards only their kind.
    expect(cardKind(page('| types = Divine-Beast'), false)).toMatchObject({
      type: 'Effect Monster',
      frameType: 'effect',
      race: 'Divine-Beast'
    })
    expect(cardKind(page('| types = Effect'), false)).toMatchObject({ race: '' })
  })

  test('names a Spell or Trap by its property', () => {
    expect(cardKind(page('| card_type = Spell\n| property = Field'), false)).toEqual({
      type: 'Spell Card',
      frameType: 'spell',
      race: 'Field',
      level: null,
      linkval: null
    })
    expect(cardKind(page('| card_type = Trap'), false)).toMatchObject({
      frameType: 'trap',
      race: 'Normal'
    })
  })

  test('leaves out game pieces, tokens and Rush Duel cards', () => {
    for (const text of [
      '| card_type = Counter',
      '| card_type = Counter / Token',
      '| card_type = Token',
      '| card_type = Duel Marker',
      '| card_type = Non-game\n| types = Full Name',
      '| card_type = Spell\n| rush_duel = yes',
      '| image = X.png'
    ])
      expect(cardKind(page(text), false)).toBeNull()
  })
})

test('a scan file tells a Token printing apart by the art it names', () => {
  expect(parseGalleryCodes(GENERIC_GALLERY).get('TKN4-EN008')).toBe(
    'Token-TKN4-EN-OP-OjamaYellow.png'
  )
  expect(fileArtName('Token-TKN4-EN-SR-UE-OjamaYellow.png')).toBe('Ojama Yellow')
  expect(fileArtName('Token-TKN4-EN-OP-OjamaYellow.png')).toBe('Ojama Yellow')
  expect(fileArtName('Token-EV01-EN-C-UE-1.png')).toBeNull()
  const files = ['Token-TKN4-EN-SR-UE-OjamaBlack.png', 'Token-TKN4-EN-SR-UE-OjamaYellow.png']
  expect(
    choosePrintingFile(files, {
      setCode: 'TKN4-EN008',
      language: 'en',
      rarity: 'Super Rare',
      variant: 'Ojama Yellow'
    })
  ).toBe(files[1])
})

describe('refreshTokens', () => {
  test('adds a character token as a card with its printing and art, findable by code', async () => {
    const out = await refreshTokens(db, fake(), now)
    expect(out).toMatchObject({ ok: true, addedCards: 6, changed: true, skipped: [] })
    const id = tokenId(1200)
    expect(db.prepare('SELECT * FROM cards WHERE id = ?').get(id)).toMatchObject({
      name: NASH,
      type: 'Token',
      frame_type: 'token',
      game: 'ygo',
      updated_at: now.toISOString()
    })
    expect(
      db.prepare('SELECT image_id FROM card_images WHERE card_id = ?').pluck().all(id)
    ).toEqual([tokenId(7000)])
    const [found] = printingsByCode(db, 'TKN5-EN055')
    expect(found).toMatchObject({
      cardId: id,
      name: NASH,
      imageIds: [tokenId(7000)],
      frameType: 'token'
    })
    expect(
      browseCards(db, { search: 'Silent Honor', sort: 'name', dir: 'asc' } as never).cards.map(
        (c) => c.id
      )
    ).toContain(id)
    expect(getMeta(db, 'intl_sets_synced_at')).toBeNull()
  })

  test('adds a card printed with no passcode as the card it is, findable by code', async () => {
    await refreshTokens(db, fake(), now)
    const id = tokenId(2000)
    expect(db.prepare('SELECT * FROM cards WHERE id = ?').get(id)).toMatchObject({
      name: BLS,
      type: 'Normal Monster',
      frame_type: 'normal',
      race: 'Warrior',
      attribute: 'EARTH',
      level: 8,
      atk: 3000,
      def: 2500,
      desc: 'The mightiest warrior, whose abilities equal the Blue-Eyes White Dragon.'
    })
    const [found] = printingsByCode(db, '25TH-EN001')
    expect(found).toMatchObject({
      cardId: id,
      name: BLS,
      imageIds: [tokenId(8000)],
      frameType: 'normal'
    })
    expect(db.prepare('SELECT type FROM cards WHERE id = ?').pluck().get(tokenId(2010))).toBe(
      'Synchro Tuner Monster'
    )
    // A monster whose page names no Type.
    expect(db.prepare('SELECT race FROM cards WHERE id = ?').pluck().get(tokenId(2050))).toBe('')
  })

  test('leaves out game pieces, Rush Duel cards and cards YGOPRODeck lists', async () => {
    await refreshTokens(db, fake(), now)
    for (const pageId of [2020, 2030, 2040])
      expect(db.prepare('SELECT 1 FROM cards WHERE id = ?').get(tokenId(pageId))).toBeUndefined()
    expect(printingsByCode(db, 'DMPR-EN001')).toEqual([])
    expect(db.prepare('SELECT count(*) FROM cards WHERE name = ?').pluck().get(NASH)).toBe(1)
  })

  test('runs again at once for an app that learns new kinds of card', async () => {
    await refreshTokens(db, fake(), now)
    expect(shouldRefreshTokens(db, now)).toBe(false)
    // As an older app left it: synced a day ago, tokens only.
    db.prepare("DELETE FROM meta WHERE key = 'token_cards_kinds'").run()
    expect(shouldRefreshTokens(db, now)).toBe(true)
  })

  test('gives a listed token its English printing, without a new card', async () => {
    await refreshTokens(db, fake(), now)
    expect(printings(22404676)).toEqual([
      expect.objectContaining({ set_code: 'TKN4-EN027', set_rarity: 'Super Rare' })
    ])
    expect(printingsByCode(db, 'TKN4-EN027').map((p) => p.cardId)).toEqual([22404676])
    expect(db.prepare("SELECT count(*) FROM cards WHERE name = 'Vassal Token'").pluck().get()).toBe(
      1
    )
  })

  test('the plain Token page keeps only codes no other card has, named by their art', async () => {
    await refreshTokens(db, fake(), now)
    expect(printings(tokenId(50))).toEqual([
      expect.objectContaining({ set_code: 'TKN4-EN008', variant: 'Ojama Yellow' })
    ])
  })

  test('leaves unprinted tokens out and skips a card with no scan', async () => {
    const out = await refreshTokens(
      db,
      fake({
        filePageIds: async (files) =>
          new Map(files.filter((f) => f === NASH_FILE).map((f) => [f, 7000]))
      }),
      now
    )
    expect(out.skipped.sort()).toEqual([
      BLS,
      'Darkness/Monster A',
      'Stardust Divinity',
      'Token (Yusei and Stardust Dragon)',
      'Token (card)'
    ])
    expect(db.prepare("SELECT 1 FROM cards WHERE name = 'Cynet Token'").get()).toBeUndefined()
  })

  test('a second run changes nothing, and a rename keeps the card', async () => {
    await refreshTokens(db, fake(), now)
    const row = db.prepare('SELECT * FROM cards WHERE id = ?').get(tokenId(1200))
    const again = await refreshTokens(db, fake(), new Date('2026-11-06T12:00:00.000Z'))
    expect(again).toMatchObject({ addedCards: 0, changed: false })
    expect(db.prepare('SELECT * FROM cards WHERE id = ?').get(tokenId(1200))).toEqual(row)
    await refreshTokens(
      db,
      fake({
        listCategoryPages: async () => [{ title: 'Token (Nash)', pageId: 1200 }],
        fetchPages: async (titles) => new Map(titles.map((t) => [t, NASH_PAGE]))
      }),
      now
    )
    expect(db.prepare('SELECT name FROM cards WHERE id = ?').pluck().get(tokenId(1200))).toBe(
      'Token (Nash)'
    )
    expect(printingsByCode(db, 'TKN5-EN055')).toHaveLength(1)
  })

  test('a printing Yugipedia drops goes, unless it is owned, and so does a replaced scan', async () => {
    await refreshTokens(db, fake(), now)
    const printing = printingsByCode(db, 'TKN5-EN055')[0].printingId
    db.prepare(
      `INSERT INTO collection_entries (uid, printing_id, image_id, quantity, created_at, updated_at)
       VALUES ('u', ?, ?, 1, '2026-10-30', '2026-10-30')`
    ).run(printing, tokenId(7000))
    const moved = NASH_PAGE.replace('TKN5-EN055', 'TKN5-EN099').replace(NASH_FILE, 'New.png')
    await refreshTokens(
      db,
      fake({
        fetchPages: async () => new Map([[NASH, moved]]),
        listCategoryPages: async () => [{ title: NASH, pageId: 1200 }],
        filePageIds: async () => new Map([['New.png', 7500]])
      }),
      now
    )
    expect(printings(tokenId(1200)).map((p) => p.set_code)).toEqual(['TKN5-EN055', 'TKN5-EN099'])
    expect(
      db.prepare('SELECT missing_from_api FROM card_printings WHERE id = ?').pluck().get(printing)
    ).toBe(1)
    expect(
      db
        .prepare(
          'SELECT image_id, missing_from_api FROM card_images WHERE card_id = ? ORDER BY image_id'
        )
        .all(tokenId(1200))
    ).toEqual([
      { image_id: tokenId(7000), missing_from_api: 1 },
      { image_id: tokenId(7500), missing_from_api: 0 }
    ])
  })

  test('trouble keeps the stored rows and tries again next run', async () => {
    await refreshTokens(db, fake(), now)
    const n = db.prepare('SELECT count(*) FROM card_printings').pluck().get()
    setMeta(db, 'token_cards_synced_at', '2026-01-01T00:00:00.000Z')
    const empty = await refreshTokens(db, fake({ listCategoryPages: async () => [] }), now)
    const down = await refreshTokens(
      db,
      fake({
        fetchPages: async () => {
          throw new Error('down')
        }
      }),
      now
    )
    expect([empty.ok, down.ok]).toEqual([false, false])
    expect(db.prepare('SELECT count(*) FROM card_printings').pluck().get()).toBe(n)
    expect(shouldRefreshTokens(db, now)).toBe(true)
  })

  test('survives the nightly card sync, whose payload knows none of it', async () => {
    await refreshTokens(db, fake(), now)
    const client: YgoClient = {
      fetchDbVersion: async () => ({ databaseVersion: '2', lastUpdate: '2026-10-30' }),
      fetchCardInfo: async () => fixture.data as ApiCard[],
      fetchCardSets: async () => []
    }
    await runSync(db, client, () => {}, now)
    expect(printings(tokenId(1200))).toHaveLength(1)
    expect(printings(tokenId(2000))).toHaveLength(1)
    expect(printings(22404676)).toHaveLength(1)
    expect(
      db.prepare('SELECT 1 FROM card_images WHERE image_id = ?').get(tokenId(7000))
    ).toBeTruthy()
  })

  test('the TCGplayer refresh keeps a Token printing named by its art and prices it by code', async () => {
    await refreshTokens(db, fake(), now)
    db.prepare(
      "INSERT INTO tcgplayer_groups (group_id, modified_on, name) VALUES (1, 'a', 'Promos')"
    ).run()
    db.prepare(
      `INSERT INTO tcgplayer_products (product_id, group_id, number, rarity, image_url, name)
       VALUES (9, 1, 'TKN4-EN008', 'Super Rare', 'https://tcgplayer-cdn.tcgplayer.com/product/9_in_1000x1000.jpg', 'Token: Ojama')`
    ).run()
    saveTcgVariants(db)
    expect(printings(tokenId(50))[0].variant).toBe('Ojama Yellow')
  })

  test('the non-English sync then finds a token in a set list by its title', async () => {
    await refreshTokens(db, fake(), now)
    const list = `{{Set list|region=JP|rarities=Rare, Ultra Rare|\nTK02-JP014; ${NASH}\n}}`
    const title = 'Set Card Lists:Token Pack Vol.2 (OCG-JP)'
    await refreshIntlSets(
      db,
      fake({
        listSetListTitles: async () => [title],
        fetchPages: async (t) => new Map(t.filter((x) => x === title).map((x) => [x, list]))
      }),
      now
    )
    expect(printingsByCode(db, 'TK02-JP014').map((p) => [p.cardId, p.rarity])).toEqual([
      [tokenId(1200), 'Rare'],
      [tokenId(1200), 'Ultra Rare']
    ])
  })

  test('the non-English sync finds a card with no passcode in a set list by its title', async () => {
    await refreshTokens(db, fake(), now)
    const list = `{{Set list|region=JP|rarities=Super Rare, Secret Rare, Ultimate Rare|\nYAC1-JP026; ${BLS}\n}}`
    const title = 'Set Card Lists:Original Artwork Collection (OCG-JP)'
    await refreshIntlSets(
      db,
      fake({
        listSetListTitles: async () => [title],
        fetchPages: async (t) => new Map(t.filter((x) => x === title).map((x) => [x, list]))
      }),
      now
    )
    expect(
      printingsByCode(db, 'YAC1-JP026')
        .map((p) => [p.cardId, p.rarity])
        .sort()
    ).toEqual([
      [tokenId(2000), 'Secret Rare'],
      [tokenId(2000), 'Super Rare'],
      [tokenId(2000), 'Ultimate Rare']
    ])
  })
})
