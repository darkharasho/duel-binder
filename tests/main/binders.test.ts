import { describe, expect, it, vi } from 'vitest'
import type Database from 'better-sqlite3'
import { setMeta } from '../../src/main/db/meta'
import { addEntry, CollectionError, removeEntry } from '../../src/main/repo/collection'
import {
  bindersForCard,
  getBinder,
  listBinders,
  previewBinder,
  removeBinder,
  saveBinder,
  setBinderEdit
} from '../../src/main/repo/binders'
import { createDataHandlers, DATA_CHANNELS } from '../../src/main/ipc/dataHandlers'
import { localScope } from '../../src/main/repo/scope'
import {
  MAX_BINDER_EDITS,
  MAX_BINDER_MATCHES,
  MAX_BINDERS,
  type BinderDraft,
  type BinderGoal,
  type BinderRule
} from '../../src/shared/binders'
import { seedPokemon } from '../fixtures/pokemon'
import { seededDb } from './helpers'

const T1 = new Date('2026-11-01T10:00:00.000Z')
const T2 = new Date('2026-11-01T11:00:00.000Z')
const DARK_MAGICIAN = 46986414
const POT = 55144522
const DUSTER = 18144506
const LOB_DM = 'en|46986414|LOB-EN005|Ultra Rare'
const SDY_DM = 'en|46986414|SDY-006|Ultra Rare'

const name = (value: string): BinderRule => ({ field: 'name', op: 'is', value })
const draft = (over: Partial<BinderDraft> = {}, ...rules: BinderRule[]): BinderDraft => ({
  name: 'Mine',
  rules: { version: 1, rules },
  goal: 'card',
  languages: [],
  friendsVisible: true,
  ...over
})
const goal = (g: BinderGoal, uid?: string): Partial<BinderDraft> => ({ goal: g, uid })

const printingId = (db: Database.Database, pkey: string): number =>
  (db.prepare('SELECT id FROM card_printings WHERE pkey = ?').get(pkey) as { id: number }).id
const give = (db: Database.Database, pkey: string, imageId = DARK_MAGICIAN, quantity = 1): number =>
  addEntry(db, { printingId: printingId(db, pkey), imageId, quantity }, T1).id
const insertPrinting = (
  db: Database.Database,
  cardId: number,
  code: string,
  rarity = 'Common',
  contributed = 0,
  language = 'en'
): string => {
  db.prepare(
    `INSERT INTO card_printings (game, card_id, language, set_name, set_code, set_rarity, contributed)
     VALUES ('ygo', ?, ?, 'Added Set', ?, ?, ?)`
  ).run(cardId, language, code, rarity, contributed)
  return (
    db
      .prepare('SELECT pkey FROM card_printings WHERE set_code = ? AND card_id = ?')
      .get(code, cardId) as { pkey: string }
  ).pkey
}
const liveEdits = (db: Database.Database): number =>
  (
    db.prepare('SELECT COUNT(*) AS n FROM binder_edits WHERE deleted_at IS NULL').get() as {
      n: number
    }
  ).n

describe('saveBinder, listBinders and getBinder', () => {
  it('saves and reads a rule binder', async () => {
    const db = await seededDb()
    give(db, LOB_DM)
    const uid = saveBinder(db, draft({ name: '  Magic  ' }, name('Dark Magician')), T1)
    expect(listBinders(db)).toEqual([
      expect.objectContaining({
        uid,
        name: 'Magic',
        goal: 'card',
        languages: [],
        friendsVisible: true,
        hasRules: true,
        editable: true,
        ownedSlots: 1,
        missingSlots: 0,
        tooBroad: false,
        coverImageId: DARK_MAGICIAN
      })
    ])
    const detail = getBinder(db, uid)
    expect(detail?.rules.rules).toEqual([name('Dark Magician')])
    expect(detail?.cards).toHaveLength(1)
    expect(detail?.cards[0]).toMatchObject({
      key: `card:${DARK_MAGICIAN}`,
      level: 'card',
      imageId: DARK_MAGICIAN,
      owned: 1,
      added: false,
      printing: null,
      price: null
    })
    expect(detail?.cards[0].card.name).toBe('Dark Magician')
  })

  it('a manual binder holds only its hand edits, whatever the catalog has', async () => {
    const db = await seededDb()
    const uid = saveBinder(db, draft(), T1)
    expect(getBinder(db, uid)).toMatchObject({ hasRules: false, cards: [], missingSlots: 0 })
    setBinderEdit(db, uid, { level: 'card', target: String(POT) }, 'add', T1)
    const detail = getBinder(db, uid)
    expect(detail?.cards.map((c) => c.key)).toEqual([`card:${POT}`])
    expect(detail?.cards[0]).toMatchObject({ added: true, owned: 0, imageId: POT })
    expect(detail?.missingSlots).toBe(1)
  })

  it('saving again keeps the row, its order and its uid', async () => {
    const db = await seededDb()
    const a = saveBinder(db, draft({ name: 'A' }), T1)
    const b = saveBinder(db, draft({ name: 'B' }), T1)
    expect(saveBinder(db, draft({ uid: a, name: 'A2', friendsVisible: false }), T2)).toBe(a)
    expect(listBinders(db).map((x) => [x.uid, x.name, x.friendsVisible])).toEqual([
      [a, 'A2', false],
      [b, 'B', true]
    ])
  })

  it('getBinder of a deleted or unknown uid is null', async () => {
    const db = await seededDb()
    const uid = saveBinder(db, draft(), T1)
    removeBinder(db, uid, T2)
    expect(getBinder(db, uid)).toBeNull()
    expect(getBinder(db, 'nope')).toBeNull()
  })

  it("keeps another game's binder out of this scope", async () => {
    const db = await seededDb()
    seedPokemon(db)
    const uid = saveBinder(db, draft({ name: 'Pika' }), T1, localScope("'pkm'"))
    expect(listBinders(db)).toEqual([])
    expect(getBinder(db, uid)).toBeNull()
    expect(listBinders(db, localScope("'pkm'")).map((b) => b.uid)).toEqual([uid])
    expect(() => saveBinder(db, draft({ uid }), T2)).toThrow(CollectionError)
    expect(() => setBinderEdit(db, uid, { level: 'card', target: '1' }, 'add', T2)).toThrow(
      CollectionError
    )
    expect(bindersForCard(db, DARK_MAGICIAN)).toEqual([])
  })

  it('rejects a bad draft', async () => {
    const db = await seededDb()
    expect(() => saveBinder(db, draft({ name: ' ' }), T1)).toThrow(CollectionError)
    expect(() => saveBinder(db, draft({ goal: 'nope' as BinderGoal }), T1)).toThrow(CollectionError)
    const pkmArt = draft({ goal: 'art' })
    seedPokemon(db)
    expect(() => saveBinder(db, pkmArt, T1, localScope("'pkm'"))).toThrow(CollectionError)
  })

  it('stops at MAX_BINDERS for a new binder, but still saves an existing one', async () => {
    const db = await seededDb()
    let last = ''
    for (let i = 0; i < MAX_BINDERS; i++) last = saveBinder(db, draft({ name: `B${i}` }), T1)
    expect(() => saveBinder(db, draft({ name: 'One more' }), T1)).toThrow(CollectionError)
    expect(saveBinder(db, draft({ uid: last, name: 'Renamed' }), T2)).toBe(last)
    removeBinder(db, last, T2)
    expect(saveBinder(db, draft({ name: 'One more' }), T2)).toBeTruthy()
  })

  it('a binder with a newer rule format still lists, and saving it throws', async () => {
    const db = await seededDb()
    give(db, LOB_DM)
    const uid = saveBinder(db, draft({ name: 'Future' }, name('Dark Magician')), T1)
    db.prepare('UPDATE binders SET rules = ? WHERE uid = ?').run(
      JSON.stringify({ version: 2, rules: [{ field: 'mood', values: ['grim'] }] }),
      uid
    )
    expect(listBinders(db)).toEqual([
      expect.objectContaining({ uid, editable: false, hasRules: true, ownedSlots: 0 })
    ])
    expect(getBinder(db, uid)).toMatchObject({ editable: false, cards: [] })
    expect(() => saveBinder(db, draft({ uid, name: 'Nope' }), T2)).toThrow(CollectionError)
  })
})

describe('slots read from the catalog and the collection', () => {
  it('counts only copies of qualifying printings, read live', async () => {
    const db = await seededDb()
    const uid = saveBinder(
      db,
      draft({}, name('Dark Magician'), { field: 'set', values: ['Added Set'] }),
      T1
    )
    const pkey = insertPrinting(db, DARK_MAGICIAN, 'ADD-001')
    give(db, LOB_DM)
    expect(getBinder(db, uid)).toMatchObject({ ownedSlots: 0, missingSlots: 1 })
    const id = give(db, pkey)
    expect(getBinder(db, uid)).toMatchObject({ ownedSlots: 1, missingSlots: 0 })
    removeEntry(db, id, T2)
    expect(getBinder(db, uid)).toMatchObject({ ownedSlots: 0, missingSlots: 1 })
  })

  it('makes one slot per art and per printing under those goals', async () => {
    const db = await seededDb()
    const art = saveBinder(db, draft(goal('art'), name('Dark Magician')), T1)
    const each = saveBinder(db, draft(goal('printing'), name('Dark Magician')), T1)
    expect(getBinder(db, art)?.cards.map((c) => [c.key, c.imageId])).toEqual([
      [`art:${DARK_MAGICIAN}`, DARK_MAGICIAN],
      [`art:${DARK_MAGICIAN + 1}`, DARK_MAGICIAN + 1]
    ])
    const printings = getBinder(db, each)?.cards ?? []
    expect(printings.map((c) => c.key).sort()).toEqual([`printing:${LOB_DM}`, `printing:${SDY_DM}`])
    expect(printings[0].imageId).toBe(DARK_MAGICIAN)
    expect(printings.map((c) => c.printing?.setRarity)).toEqual(['Ultra Rare', 'Ultra Rare'])
  })

  it('leaves contributed and hidden printings out of Every printing, but lets them fill a card', async () => {
    const db = await seededDb()
    const contributed = insertPrinting(db, DARK_MAGICIAN, 'USR-001', 'Common', 1)
    const hidden = insertPrinting(db, DARK_MAGICIAN, 'LD-001', '2')
    const each = saveBinder(db, draft(goal('printing'), name('Dark Magician')), T1)
    const one = saveBinder(db, draft(goal('card'), name('Dark Magician')), T1)
    const keys = (uid: string): string[] => (getBinder(db, uid)?.cards ?? []).map((c) => c.key)
    expect(keys(each)).not.toContain(`printing:${contributed}`)
    expect(keys(each)).not.toContain(`printing:${hidden}`)
    expect(getBinder(db, each)?.cards).toHaveLength(2)
    give(db, contributed)
    expect(getBinder(db, one)).toMatchObject({ ownedSlots: 1, missingSlots: 0 })
    expect(keys(each)).not.toContain(`printing:${contributed}`)
  })

  it('gives a card seen only on an unlisted printing no slot', async () => {
    const db = await seededDb()
    const contributed = insertPrinting(db, POT, 'USR-002', 'Secret Rare', 1)
    const uid = saveBinder(db, draft({}, { field: 'rarity', values: ['Secret Rare'] }), T1)
    expect(getBinder(db, uid)?.cards).toEqual([])
    setBinderEdit(db, uid, { level: 'printing', target: contributed }, 'add', T1)
    expect(getBinder(db, uid)?.cards.map((c) => c.key)).toEqual([`card:${POT}`])
  })

  it('fills an added card from any printing, including ones the rule refuses', async () => {
    const db = await seededDb()
    const uid = saveBinder(db, draft({ languages: ['de'] }, name('Dark Magician')), T1)
    setBinderEdit(db, uid, { level: 'card', target: String(DARK_MAGICIAN) }, 'add', T1)
    give(db, LOB_DM)
    const detail = getBinder(db, uid)
    expect(detail?.cards.map((c) => [c.key, c.owned, c.added])).toEqual([
      [`card:${DARK_MAGICIAN}`, 1, true]
    ])
  })

  it('expands an added card through all its printings under Every printing', async () => {
    const db = await seededDb()
    const contributed = insertPrinting(db, POT, 'USR-003', 'Common', 1)
    const uid = saveBinder(db, draft(goal('printing')), T1)
    setBinderEdit(db, uid, { level: 'card', target: String(POT) }, 'add', T1)
    expect(getBinder(db, uid)?.cards.map((c) => c.key)).toEqual([
      'printing:en|55144522|LOB-EN119|Rare'
    ])
    setBinderEdit(db, uid, { level: 'printing', target: contributed }, 'add', T1)
    expect(getBinder(db, uid)?.cards).toHaveLength(2)
  })

  it('prices missing slots from the cheapest printing and says what has no price', async () => {
    const db = await seededDb()
    db.prepare('UPDATE card_printings SET market_price = NULL, set_price = NULL').run()
    db.prepare("UPDATE card_printings SET market_price = 3 WHERE set_code = 'LOB-EN005'").run()
    db.prepare("UPDATE card_printings SET market_price = 2 WHERE set_code = 'SDY-006'").run()
    const uid = saveBinder(db, draft(goal('card')), T1)
    setBinderEdit(db, uid, { level: 'card', target: String(DARK_MAGICIAN) }, 'add', T1)
    setBinderEdit(db, uid, { level: 'card', target: String(POT) }, 'add', T1)
    const detail = getBinder(db, uid)
    expect(detail).toMatchObject({ valueToFinish: 2, unpricedMissing: 1, missingSlots: 2 })
    expect(detail?.cards.find((c) => c.card.id === DARK_MAGICIAN)?.price).toBe(2)
  })

  it('reads the printing of a printing slot with its price', async () => {
    const db = await seededDb()
    db.prepare("UPDATE card_printings SET market_price = 4 WHERE set_code = 'LOB-EN005'").run()
    const uid = saveBinder(db, draft(goal('printing')), T1)
    setBinderEdit(db, uid, { level: 'printing', target: LOB_DM }, 'add', T1)
    expect(getBinder(db, uid)?.cards[0]).toMatchObject({
      key: `printing:${LOB_DM}`,
      price: 4,
      printing: { setCode: 'LOB-EN005', setPrice: 4, language: 'en' }
    })
  })

  it('shows owned matches and no missing slots under no goal', async () => {
    const db = await seededDb()
    give(db, LOB_DM)
    const uid = saveBinder(
      db,
      draft(goal('none'), { field: 'rarity', values: ['Ultra Rare', 'Rare'] }),
      T1
    )
    const detail = getBinder(db, uid)
    expect(detail?.cards.map((c) => c.card.id)).toEqual([DARK_MAGICIAN])
    expect(detail).toMatchObject({ ownedSlots: 1, missingSlots: 0, valueToFinish: 0 })
  })

  it('a card with no images falls back to art 0, and a binder with nothing has no cover', async () => {
    const db = await seededDb()
    db.prepare('DELETE FROM card_images WHERE card_id = ?').run(DUSTER)
    const uid = saveBinder(db, draft(), T1)
    expect(listBinders(db)[0].coverImageId).toBeNull()
    setBinderEdit(db, uid, { level: 'card', target: String(DUSTER) }, 'add', T1)
    expect(getBinder(db, uid)?.cards[0].imageId).toBe(0)
    expect(listBinders(db)[0].coverImageId).toBeNull()
  })

  it('prefers an owned slot for the cover', async () => {
    const db = await seededDb()
    const uid = saveBinder(db, draft(), T1)
    setBinderEdit(db, uid, { level: 'card', target: String(DARK_MAGICIAN) }, 'add', T1)
    setBinderEdit(db, uid, { level: 'card', target: String(POT) }, 'add', T1)
    addEntry(
      db,
      { printingId: printingId(db, 'en|55144522|LOB-EN119|Rare'), imageId: POT, quantity: 1 },
      T1
    )
    expect(listBinders(db)[0].coverImageId).toBe(POT)
  })

  it('reads only the active owner', async () => {
    const db = await seededDb()
    give(db, LOB_DM)
    const uid = saveBinder(db, draft({}, name('Dark Magician')), T1)
    setMeta(db, 'cloud_active_owner', '7')
    expect(listBinders(db)).toEqual([])
    expect(getBinder(db, uid)).toBeNull()
    const other = saveBinder(db, draft({}, name('Dark Magician')), T1)
    expect(getBinder(db, other)).toMatchObject({ ownedSlots: 0, missingSlots: 1 })
  })
})

describe('previewBinder', () => {
  it('counts printings, cards and owned', async () => {
    const db = await seededDb()
    give(db, LOB_DM)
    const preview = previewBinder(
      db,
      draft({}, { field: 'rarity', values: ['Ultra Rare', 'Rare'] })
    )
    expect(preview).toEqual({ printings: 3, cards: 2, owned: 1, tooBroad: false })
  })

  it('leaves contributed printings out of the counts', async () => {
    const db = await seededDb()
    insertPrinting(db, DUSTER, 'USR-004', 'Rare', 1)
    expect(previewBinder(db, draft({}, { field: 'rarity', values: ['Rare'] }))).toMatchObject({
      printings: 1,
      cards: 1
    })
  })

  it('needs no name, matches nothing with no rules, and still refuses a bad rule', async () => {
    const db = await seededDb()
    expect(previewBinder(db, draft({ name: '' }))).toEqual({
      printings: 0,
      cards: 0,
      owned: 0,
      tooBroad: false
    })
    expect(() => previewBinder(db, draft({}, { field: 'mood' as 'set', values: ['x'] }))).toThrow(
      CollectionError
    )
  })
})

describe('a rule over the cap', () => {
  const overfill = (db: Database.Database): void => {
    const ins = db.prepare(
      "INSERT INTO card_printings (game, card_id, language, set_name, set_code, set_rarity) VALUES ('ygo', ?, 'en', 'Huge', ?, 'Common')"
    )
    db.transaction(() => {
      for (let i = 0; i <= MAX_BINDER_MATCHES; i++) ins.run(POT, `HUGE-${i}`)
    })()
  }

  it('gives tooBroad with no slots, and the binder can still be saved', async () => {
    const db = await seededDb()
    overfill(db)
    const rule: BinderRule = { field: 'set', values: ['Huge'] }
    expect(previewBinder(db, draft({}, rule))).toMatchObject({ tooBroad: true, cards: 0, owned: 0 })
    const uid = saveBinder(db, draft({}, rule), T1)
    setBinderEdit(db, uid, { level: 'card', target: String(DARK_MAGICIAN) }, 'add', T1)
    expect(listBinders(db)).toEqual([
      expect.objectContaining({ uid, tooBroad: true, ownedSlots: 0, missingSlots: 0 })
    ])
    expect(getBinder(db, uid)).toMatchObject({ tooBroad: true, cards: [], valueToFinish: 0 })
    expect(saveBinder(db, draft({ uid, name: 'Still here' }, rule), T2)).toBe(uid)
  })
})

describe('removeBinder', () => {
  it('hides the binder and tombstones its edits, row by row', async () => {
    const db = await seededDb()
    const uid = saveBinder(db, draft(), T1)
    const other = saveBinder(db, draft({ name: 'Other' }), T1)
    setBinderEdit(db, uid, { level: 'card', target: String(POT) }, 'add', T1)
    setBinderEdit(db, uid, { level: 'printing', target: LOB_DM }, 'remove', T1)
    setBinderEdit(db, other, { level: 'card', target: String(POT) }, 'add', T1)
    db.prepare('UPDATE binders SET dirty = 0').run()
    db.prepare('UPDATE binder_edits SET dirty = 0').run()

    removeBinder(db, uid, T2)

    expect(listBinders(db).map((b) => b.uid)).toEqual([other])
    expect(db.prepare('SELECT deleted_at, dirty FROM binders WHERE uid = ?').get(uid)).toEqual({
      deleted_at: T2.toISOString(),
      dirty: 1
    })
    expect(
      db.prepare('SELECT deleted_at, dirty FROM binder_edits WHERE binder_uid = ?').all(uid)
    ).toEqual([
      { deleted_at: T2.toISOString(), dirty: 1 },
      { deleted_at: T2.toISOString(), dirty: 1 }
    ])
    expect(liveEdits(db)).toBe(1)
  })
})

describe('setBinderEdit', () => {
  it('stores, changes and tombstones an edit', async () => {
    const db = await seededDb()
    const uid = saveBinder(db, draft({}, name('Dark Magician')), T1)
    const target = { level: 'card', target: String(DARK_MAGICIAN) } as const
    setBinderEdit(db, uid, target, 'remove', T1)
    expect(getBinder(db, uid)?.cards).toEqual([])
    setBinderEdit(db, uid, target, 'add', T2)
    expect(getBinder(db, uid)?.cards[0]).toMatchObject({ added: true })
    setBinderEdit(db, uid, target, null, T2)
    expect(liveEdits(db)).toBe(0)
    expect(getBinder(db, uid)?.cards[0]).toMatchObject({ added: false })
    setBinderEdit(db, uid, target, 'add', T2)
    expect(liveEdits(db)).toBe(1)
  })

  it('leaves the row alone when nothing changes', async () => {
    const db = await seededDb()
    const uid = saveBinder(db, draft(), T1)
    const target = { level: 'card', target: String(POT) } as const
    setBinderEdit(db, uid, target, 'add', T1)
    db.prepare('UPDATE binder_edits SET dirty = 0').run()
    setBinderEdit(db, uid, target, 'add', T2)
    expect(db.prepare('SELECT updated_at, dirty FROM binder_edits').get()).toEqual({
      updated_at: T1.toISOString(),
      dirty: 0
    })
  })

  it('refuses an art add, but takes an art removal', async () => {
    const db = await seededDb()
    const uid = saveBinder(db, draft(goal('art'), name('Dark Magician')), T1)
    const target = { level: 'art', target: String(DARK_MAGICIAN + 1) } as const
    expect(() => setBinderEdit(db, uid, target, 'add', T1)).toThrow(CollectionError)
    setBinderEdit(db, uid, target, 'remove', T1)
    expect(getBinder(db, uid)?.cards.map((c) => c.key)).toEqual([`art:${DARK_MAGICIAN}`])
  })

  it('refuses a bad level, target or action, and an unknown binder', async () => {
    const db = await seededDb()
    const uid = saveBinder(db, draft(), T1)
    const bad = (target: unknown, action: unknown = 'add'): void =>
      setBinderEdit(db, uid, target as never, action as never, T1)
    expect(() => bad({ level: 'set', target: 'x' })).toThrow(CollectionError)
    expect(() => bad({ level: 'card', target: 'x' })).toThrow(CollectionError)
    expect(() => bad({ level: 'art', target: '' }, 'remove')).toThrow(CollectionError)
    expect(() => bad({ level: 'printing', target: '' })).toThrow(CollectionError)
    expect(() => bad({ level: 'printing', target: LOB_DM }, 'keep')).toThrow(CollectionError)
    expect(() =>
      setBinderEdit(db, 'nope', { level: 'card', target: String(POT) }, 'add', T1)
    ).toThrow(CollectionError)
  })

  it('stops a binder at MAX_BINDER_EDITS, but still changes or drops an edit', async () => {
    const db = await seededDb()
    const uid = saveBinder(db, draft(), T1)
    const ins = db.prepare(
      `INSERT INTO binder_edits (binder_uid, level, target, game, action, created_at, updated_at)
       VALUES (?, 'printing', ?, 'ygo', 'add', 't', 't')`
    )
    db.transaction(() => {
      for (let i = 0; i < MAX_BINDER_EDITS; i++) ins.run(uid, `absent-${i}`)
    })()
    const fresh = { level: 'card', target: String(POT) } as const
    const known = { level: 'printing', target: 'absent-1' } as const
    expect(() => setBinderEdit(db, uid, fresh, 'add', T1)).toThrow(CollectionError)
    setBinderEdit(db, uid, known, 'remove', T1)
    setBinderEdit(db, uid, known, null, T1)
    setBinderEdit(db, uid, fresh, 'add', T1)
    expect(liveEdits(db)).toBe(MAX_BINDER_EDITS)
  })

  it('an edit naming an absent printing is harmless, and shows once the printing exists', async () => {
    const db = await seededDb()
    const uid = saveBinder(db, draft(goal('printing')), T1)
    const pkey = 'en|55144522|LATE-001|Common'
    setBinderEdit(db, uid, { level: 'printing', target: pkey }, 'add', T1)
    expect(getBinder(db, uid)).toMatchObject({ cards: [], missingSlots: 0 })
    expect(insertPrinting(db, POT, 'LATE-001')).toBe(pkey)
    expect(getBinder(db, uid)?.cards.map((c) => c.key)).toEqual([`printing:${pkey}`])
  })

  it.each(['none', 'card', 'art', 'printing'] as const)(
    'an edit naming an absent card makes no slot under %s, and is not missing',
    async (g) => {
      const db = await seededDb()
      const uid = saveBinder(db, draft(goal(g)), T1)
      setBinderEdit(db, uid, { level: 'card', target: '999' }, 'add', T1)
      expect(getBinder(db, uid)).toMatchObject({ cards: [], missingSlots: 0, ownedSlots: 0 })
      db.prepare(
        `INSERT INTO cards (id, game, name, type, frame_type, race, desc, updated_at)
         VALUES (999, 'ygo', 'Late', 'Spell Card', 'spell', 'Normal', '', 't')`
      ).run()
      if (g !== 'none') expect(getBinder(db, uid)?.missingSlots).toBeGreaterThan(0)
      expect(getBinder(db, uid)?.cards[0]?.card.name).toBe('Late')
    }
  )

  it('ignores an edit of a deleted binder', async () => {
    const db = await seededDb()
    const uid = saveBinder(db, draft(), T1)
    removeBinder(db, uid, T2)
    db.prepare(
      `INSERT INTO binder_edits (binder_uid, level, target, game, action, created_at, updated_at)
       VALUES (?, 'card', ?, 'ygo', 'add', 't', 't')`
    ).run(uid, String(POT))
    expect(listBinders(db)).toEqual([])
    expect(bindersForCard(db, POT)).toEqual([])
    const fresh = saveBinder(db, draft(), T2)
    expect(getBinder(db, fresh)?.cards).toEqual([])
  })
})

describe('bindersForCard', () => {
  it('reports match and edits per binder', async () => {
    const db = await seededDb()
    const matched = saveBinder(db, draft({ name: 'Matched' }, name('Dark Magician')), T1)
    const elsewhere = saveBinder(db, draft({ name: 'Elsewhere' }, name('Pot of Greed')), T1)
    const added = saveBinder(db, draft({ name: 'Added' }), T1)
    const removed = saveBinder(db, draft({ name: 'Removed' }, name('Dark Magician')), T1)
    const byPrinting = saveBinder(db, draft({ name: 'By printing' }), T1)
    setBinderEdit(db, added, { level: 'card', target: String(DARK_MAGICIAN) }, 'add', T1)
    setBinderEdit(db, removed, { level: 'card', target: String(DARK_MAGICIAN) }, 'remove', T1)
    setBinderEdit(db, byPrinting, { level: 'printing', target: LOB_DM }, 'add', T1)
    expect(bindersForCard(db, DARK_MAGICIAN)).toEqual([
      { uid: matched, name: 'Matched', inBinder: true, edit: null },
      { uid: elsewhere, name: 'Elsewhere', inBinder: false, edit: null },
      { uid: added, name: 'Added', inBinder: true, edit: 'add' },
      { uid: removed, name: 'Removed', inBinder: false, edit: 'remove' },
      { uid: byPrinting, name: 'By printing', inBinder: true, edit: 'add' }
    ])
  })

  it('agrees with the binder page on a no-goal binder and on removed printings', async () => {
    const db = await seededDb()
    const none = saveBinder(db, draft(goal('none'), name('Dark Magician')), T1)
    const each = saveBinder(db, draft(goal('printing'), name('Pot of Greed')), T1)
    setBinderEdit(
      db,
      each,
      { level: 'printing', target: 'en|55144522|LOB-EN119|Rare' },
      'remove',
      T1
    )
    expect(bindersForCard(db, DARK_MAGICIAN)[0]).toMatchObject({ uid: none, inBinder: false })
    give(db, LOB_DM)
    expect(bindersForCard(db, DARK_MAGICIAN)[0]).toMatchObject({ uid: none, inBinder: true })
    expect(bindersForCard(db, POT)[1]).toMatchObject({ uid: each, inBinder: false, edit: 'remove' })
  })

  it('does not call every card a match of a manual binder', async () => {
    const db = await seededDb()
    saveBinder(db, draft(), T1)
    expect(bindersForCard(db, POT)[0].inBinder).toBe(false)
  })
})

describe('binders channels', () => {
  it('saves and reads through the data handlers, and a write schedules a sync', async () => {
    const db = await seededDb()
    const onEdit = vi.fn()
    const h = createDataHandlers({
      db,
      onEdit,
      availableGames: () => ['ygo'],
      onGameChanged: () => {}
    })
    for (const c of ['list', 'get', 'preview', 'save', 'remove', 'edit', 'forCard', 'fieldValues'])
      expect(DATA_CHANNELS).toContain(`binders:${c}`)
    const uid = (await h['binders:save'](draft({}, name('Dark Magician')))) as string
    expect(onEdit).toHaveBeenCalledTimes(1)
    expect(await h['binders:list']()).toHaveLength(1)
    expect(await h['binders:get'](uid)).toMatchObject({ uid, name: 'Mine' })
    expect(await h['binders:get']('nope')).toBeNull()
    expect(await h['binders:fieldValues']('rarity', 'ultra')).toContain('Ultra Rare')
    await h['binders:edit'](uid, { level: 'card', target: String(POT) }, 'add')
    expect(onEdit).toHaveBeenCalledTimes(2)
    await h['binders:remove'](uid)
    expect(onEdit).toHaveBeenCalledTimes(3)
    expect(await h['binders:list']()).toEqual([])
  })
})

describe('listBinders summaries', () => {
  const summaryCounts = (b: { uid: string; ownedSlots: number; missingSlots: number; tooBroad: boolean; coverImageId: number | null; hasRules: boolean }) => ({
    uid: b.uid,
    ownedSlots: b.ownedSlots,
    missingSlots: b.missingSlots,
    tooBroad: b.tooBroad,
    coverImageId: b.coverImageId,
    hasRules: b.hasRules
  })

  it('equal getBinder for every goal, with copies, edits and a too-broad binder', async () => {
    const db = await seededDb()
    give(db, LOB_DM)
    const dmImage = (db.prepare('SELECT image_id FROM card_images WHERE card_id = ? LIMIT 1').get(POT) as { image_id: number }).image_id
    const potPrinting = (db.prepare('SELECT id FROM card_printings WHERE card_id = ? LIMIT 1').get(POT) as { id: number }).id
    addEntry(db, { printingId: potPrinting, imageId: dmImage, quantity: 2 }, T1)
    const goals: BinderGoal[] = ['none', 'card', 'art', 'printing']
    const ruleSets: BinderRule[][] = [
      [name('Dark Magician')],
      [{ field: 'name', op: 'contains', value: 'a' }],
      [{ field: 'rarity', values: ['Ultra Rare'] }],
      [{ field: 'cardType', values: ['Spell Card'] }],
      [name('Dark Magician'), { field: 'rarity', values: ['Ultra Rare'] }],
      []
    ]
    const uids = goals.flatMap((g) =>
      ruleSets.map((r, i) => saveBinder(db, draft({ goal: g, name: `${g}${i}` }, ...r), T1))
    )
    setBinderEdit(db, uids[0], { level: 'card', target: String(POT) }, 'add', T1)
    setBinderEdit(db, uids[5], { level: 'printing', target: LOB_DM }, 'add', T1)
    setBinderEdit(db, uids[9], { level: 'card', target: String(DUSTER) }, 'add', T1)
    setBinderEdit(db, uids[10], { level: 'printing', target: SDY_DM }, 'remove', T1)
    setBinderEdit(db, uids[11], { level: 'card', target: String(DARK_MAGICIAN) }, 'add', T1)
    setBinderEdit(db, uids[18], { level: 'card', target: String(DARK_MAGICIAN) }, 'remove', T1)

    const listed = listBinders(db)
    expect(listed).toHaveLength(uids.length)
    expect(listed.some((b) => b.ownedSlots > 0)).toBe(true)
    expect(listed.some((b) => b.missingSlots > 0)).toBe(true)
    for (const summary of listed) {
      expect(summaryCounts(summary)).toEqual(summaryCounts(getBinder(db, summary.uid)!))
    }
  })

  it('a too-broad binder reads the same in both', async () => {
    const db = await seededDb()
    const insert = db.prepare(
      "INSERT INTO card_printings (game, card_id, language, set_name, set_code, set_rarity) VALUES ('ygo', ?, 'en', 'Bulk', ?, 'Bulk Rare')"
    )
    const fill = db.transaction(() => {
      for (let i = 0; i <= MAX_BINDER_MATCHES; i++) insert.run(POT, `BLK-${i}`)
    })
    fill()
    const uid = saveBinder(db, draft({}, { field: 'name', op: 'is', value: 'Pot of Greed' }), T1)
    const [summary] = listBinders(db)
    expect(summary.tooBroad).toBe(true)
    expect(summaryCounts(summary)).toEqual(summaryCounts(getBinder(db, uid)!))
  })

  it('a binder with no rules never queries the printings', async () => {
    const db = await seededDb()
    const uid = saveBinder(db, draft({ goal: 'printing' }), T1)
    const prepare = vi.spyOn(db, 'prepare')
    expect(listBinders(db)[0].missingSlots).toBe(0)
    expect(getBinder(db, uid)?.cards).toEqual([])
    const sql = prepare.mock.calls.map(([s]) => s).filter((s) => /card_printings/.test(s))
    expect(sql).toEqual([])
    prepare.mockRestore()
  })

  it('keeps a rule-matched binder ordered by printing whichever way it was read', async () => {
    const db = await seededDb()
    const uid = saveBinder(db, draft({ goal: 'printing' }, name('Dark Magician')), T1)
    const shown = getBinder(db, uid)!.cards.map((c) => c.printing!.id)
    expect(shown).toEqual([...shown].sort((a, b) => a - b))
  })
})

