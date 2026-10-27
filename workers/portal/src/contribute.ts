import type { SqlDb } from '../../../src/main/db/sql'
import { PKEY_SQL } from '../../../src/main/catalog/upsert'
import { LANGUAGES } from '../../../src/shared/languages'
import {
  CONTRIBUTE_DAILY_CAP,
  type ContributeResult,
  type ContributedPrinting
} from '../../../src/shared/catalogFeed'

const DAY_MS = 86_400_000
const LANGUAGE_CODES = new Set<string>(LANGUAGES.map((l) => l.code))

// No control characters (C0, DEL, C1) and no `|`, which joins the fields of a pkey: with it two
// different printings could share one.
// eslint-disable-next-line no-control-regex
const FORBIDDEN = /[\u0000-\u001f\u007f-\u009f|]/
/** Non-empty trimmed text of at most 200 characters. */
const isText = (v: unknown): v is string =>
  typeof v === 'string' && v.length >= 1 && v.length <= 200 && v.trim() === v && !FORBIDDEN.test(v)
const isId = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0

type Checked = { row: ContributedPrinting } | { reason: 'bad-field' | 'bad-language' }

function check(raw: unknown): Checked {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { reason: 'bad-field' }
  const r = raw as Record<string, unknown>
  const optionalText = (v: unknown): boolean => v === null || isText(v)
  if (
    !isId(r.card_id) ||
    !isText(r.set_name) ||
    !isText(r.set_code) ||
    !isText(r.set_rarity) ||
    !optionalText(r.set_rarity_code) ||
    !optionalText(r.variant) ||
    !(r.tcg_product_id === null || isId(r.tcg_product_id)) ||
    typeof r.language !== 'string'
  )
    return { reason: 'bad-field' }
  if (!LANGUAGE_CODES.has(r.language)) return { reason: 'bad-language' }
  // Only the known fields are kept; anything else a client sends (prices included) is dropped.
  return {
    row: {
      card_id: r.card_id,
      set_name: r.set_name,
      set_code: r.set_code,
      set_rarity: r.set_rarity,
      set_rarity_code: r.set_rarity_code as string | null,
      language: r.language,
      variant: r.variant as string | null,
      tcg_product_id: r.tcg_product_id as number | null
    }
  }
}

/**
 * Adds printings that exist only on a desktop, marked `contributed`. Each row is judged on its
 * own. The pkey is always computed here; prices are never taken from the client.
 */
export function contributePrintings(
  db: SqlDb,
  userId: number,
  rows: unknown[],
  now: Date
): ContributeResult[] {
  const nowIso = now.toISOString()
  const since = new Date(now.getTime() - DAY_MS).toISOString()
  const used = (
    db
      .prepare('SELECT count(*) AS n FROM printing_contributions WHERE user_id = ? AND created_at > ?')
      .get(userId, since) as { n: number }
  ).n
  let addedNow = 0

  const hasCard = db.prepare('SELECT 1 FROM cards WHERE id = ?')
  const keyOf = db.prepare(`SELECT ${PKEY_SQL} AS pkey`)
  const exists = db.prepare('SELECT 1 FROM card_printings WHERE pkey = ?')
  // set_rarity_code is NOT NULL (default ''); the desktop sends null for an empty one.
  const insert = db.prepare(
    `INSERT INTO card_printings (card_id, set_name, set_code, set_rarity, set_rarity_code,
       language, variant, tcg_product_id, set_price, market_price, missing_from_api, contributed)
     VALUES (?, ?, ?, ?, COALESCE(?, ''), ?, ?, ?, NULL, NULL, 0, 1)`
  )
  const log = db.prepare(
    'INSERT INTO printing_contributions (printing_id, user_id, created_at) VALUES (?, ?, ?)'
  )

  return rows.map((raw): ContributeResult => {
    const checked = check(raw)
    if (!('row' in checked)) return { pkey: '', status: 'rejected', reason: checked.reason }
    const p = checked.row
    if (!hasCard.get(p.card_id)) return { pkey: '', status: 'rejected', reason: 'unknown-card' }

    const { language: l, card_id: c, set_name: n, set_code: s, set_rarity: r } = p
    const { pkey } = keyOf.get(l, c, s, r, l, c, n, s, r) as { pkey: string }
    if (exists.get(pkey)) return { pkey, status: 'exists' }
    if (used + addedNow >= CONTRIBUTE_DAILY_CAP)
      return { pkey, status: 'rejected', reason: 'daily-limit' }

    const id = insert.run(
      c, n, s, r, p.set_rarity_code, l, p.variant, p.tcg_product_id
    ).lastInsertRowid
    log.run(Number(id), userId, nowIso)
    addedNow++
    return { pkey, status: 'added' }
  })
}
