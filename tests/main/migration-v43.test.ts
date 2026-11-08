import { migrate } from '../../src/main/db/database'
import { databaseAt } from './helpers'

describe('migration V43 (one per-card eBay price on several rarities)', () => {
  it('drops a per-card price shared across rarities and keeps sweep splits and lone prices', () => {
    const db = databaseAt(42)
    db.prepare(
      `INSERT INTO cards (id, name, type, frame_type, race, "desc", updated_at)
       VALUES (1, 'Blue-Eyes', 'Fusion Monster', 'fusion', 'Dragon', '', '2026-10-01')`
    ).run()
    const add = (
      lang: string,
      code: string,
      rarity: string,
      price: number | null,
      at: string
    ): number => {
      const { id } = db
        .prepare(
          `INSERT INTO card_printings (card_id, language, set_name, set_code, set_rarity)
           VALUES (1, ?, 'Revolution Booster', ?, ?) RETURNING id`
        )
        .get(lang, code, rarity) as { id: number }
      db.prepare(
        'INSERT INTO intl_prices (printing_id, price, listing_count, checked_at) VALUES (?, ?, 2, ?)'
      ).run(id, price, at)
      return id
    }
    const shared = [
      add('ko', 'RV01-KR005', 'Ultra Rare', 77.99, '2026-10-29T09:33:36Z'),
      add('ko', 'RV01-KR005', 'Secret Rare', 77.99, '2026-10-29T09:33:37Z'),
      add('ko', 'RV01-KR005', 'Prismatic Secret Rare', 77.99, '2026-10-29T09:33:38Z')
    ]
    const kept = [
      // A sweep: one time, its own price per rarity, even when two happen to match.
      add('ja', 'RV01-JP005', 'Ultra Rare', 2, '2026-11-05T11:01:52Z'),
      add('ja', 'RV01-JP005', 'Secret Rare', 2, '2026-11-05T11:01:52Z'),
      // Different prices per rarity.
      add('ko', 'RV01-KR006', 'Ultra Rare', 3, '2026-10-29T09:33:39Z'),
      add('ko', 'RV01-KR006', 'Secret Rare', 9, '2026-10-29T09:33:40Z'),
      // A blank code groups nothing.
      add('ja', '', 'Ultra Rare', 5, '2026-10-30T07:35:07Z'),
      add('ja', '', 'Secret Rare', 5, '2026-10-30T07:35:08Z')
    ]
    migrate(db)
    const left = new Set(
      (db.prepare('SELECT printing_id AS id FROM intl_prices').all() as { id: number }[]).map(
        (r) => r.id
      )
    )
    expect(shared.filter((id) => left.has(id))).toEqual([])
    expect(kept.filter((id) => left.has(id))).toEqual(kept)
    db.close()
  })
})
