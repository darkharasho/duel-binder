import { describe, expect, it } from 'vitest'
import { addEntry } from '../../src/main/repo/collection'
import {
  bindersForCard,
  getBinder,
  listBinders,
  previewBinder,
  removeBinder,
  saveBinder,
  setBinderEdit
} from '../../src/main/repo/binders'
import { userScope } from '../../workers/portal/src/scope'
import { addUser, seededServerDb } from './helpers'

const NOW = new Date('2026-11-01T12:00:00.000Z')
const DARK_MAGICIAN = 46986414
const POT = 55144522
const rule = {
  version: 1,
  rules: [{ field: 'name' as const, op: 'is' as const, value: 'Dark Magician' }]
}

describe('binder repo on the server', () => {
  it('runs for one user, and numbers every tombstone on its own seq', async () => {
    const db = await seededServerDb()
    const me = userScope(addUser(db, '1', 'me'), 'ygo')
    const bob = userScope(addUser(db, '2', 'bob'), 'ygo')
    const draft = {
      name: 'Magic',
      rules: rule,
      goal: 'printing' as const,
      languages: [],
      friendsVisible: true
    }
    const { id, image_id } = db
      .prepare(
        `SELECT p.id, i.image_id FROM card_printings p JOIN card_images i ON i.card_id = p.card_id
         WHERE p.card_id = ? ORDER BY p.id LIMIT 1`
      )
      .get(DARK_MAGICIAN) as { id: number; image_id: number }
    addEntry(db, { printingId: id, imageId: image_id, quantity: 1 }, NOW, me)
    addEntry(db, { printingId: id, imageId: image_id, quantity: 1 }, NOW, bob)

    expect(previewBinder(db, draft, me)).toEqual({
      printings: 2,
      cards: 1,
      owned: 1,
      tooBroad: false
    })
    const uid = saveBinder(db, draft, NOW, me)
    setBinderEdit(db, uid, { level: 'card', target: String(POT) }, 'add', NOW, me)
    setBinderEdit(
      db,
      uid,
      { level: 'printing', target: 'en|46986414|SDY-006|Ultra Rare' },
      'remove',
      NOW,
      me
    )

    expect(listBinders(db, bob)).toEqual([])
    expect(getBinder(db, uid, bob)).toBeNull()
    expect(getBinder(db, uid, me)?.cards.map((c) => [c.key, c.owned, c.added])).toEqual([
      ['printing:en|46986414|LOB-EN005|Ultra Rare', 1, false],
      ['printing:en|55144522|LOB-EN119|Rare', 0, true]
    ])
    expect(bindersForCard(db, DARK_MAGICIAN, me)).toEqual([
      { uid, name: 'Magic', inBinder: true, edit: 'remove' }
    ])

    removeBinder(db, uid, NOW, me)
    expect(listBinders(db, me)).toEqual([])
    const seqs = db.prepare('SELECT seq FROM binder_edits WHERE deleted_at IS NOT NULL').all()
    expect(new Set(seqs.map((r) => (r as { seq: number }).seq)).size).toBe(2)
  })
})
