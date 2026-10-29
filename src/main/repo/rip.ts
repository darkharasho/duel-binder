import type { SqlDb } from '../db/sql'
import { listSets } from './sets'
import { localScope } from './scope'
import { setPrefix } from '../../shared/sets'
import { canonicalRarity, compareRarity } from '../../shared/rip/rarity'
import { RIP_SET_LAYOUTS, describeLayout, layoutFor, tierFor } from '../../shared/rip/layouts'
import { canFill, mulberry32, rollPack } from '../../shared/rip/roll'
import type {
  PackLayout,
  PoolCard,
  RipCard,
  RipHistory,
  RipSessionDetail,
  RipSessionSummary,
  RipSet
} from '../../shared/rip/types'

/** Set-code prefix → layout id. Tests inject their own. */
type LayoutMap = Record<string, string>

const MAX_PACKS = 100

/** Rip is Yu-Gi-Oh only, whatever game is active. */
const YGO = localScope("'ygo'")

/** Products that share a core set's code but aren't core boosters, so have no researched layout. */
const NOT_CORE =
  /Sneak Peek|Special Edition|Deluxe Edition|Super Edition|Advance Edition|25th Anniversary|Premiere!|Tin\b/

/**
 * A set with this layout that's really another product under the same code (a core set's Special
 * Edition, say). Only core layouts are shared like that; the others name one product.
 */
const sharesCode = (setName: string, layout: PackLayout): boolean =>
  layout.id.startsWith('core-') && NOT_CORE.test(setName)

interface PoolRow {
  pkey: string
  card_id: number
  name: string
  set_code: string
  set_rarity: string
  variant: string | null
  frame_type: string
  image_id: number | null
}

/**
 * Every visible English printing of a set, each with its card's first image. No prices. Rarities are
 * respelled to Rip's own (YGOPRODeck has "PLatinum Secret Rare" in RA05).
 */
export function ripPool(db: SqlDb, setName: string): PoolCard[] {
  const rows = db
    .prepare(
      `SELECT p.pkey, p.card_id, c.name, p.set_code, p.set_rarity, p.variant, c.frame_type,
              (SELECT ci.image_id FROM card_images ci WHERE ci.card_id = p.card_id AND ci.game = 'ygo'
               ORDER BY ci.sort_order, ci.image_id LIMIT 1) AS image_id
       FROM card_printings p JOIN cards c ON c.id = p.card_id AND c.game = 'ygo'
       WHERE p.game = 'ygo' AND p.language = 'en' AND p.contributed = 0 AND p.set_name = ?
       ORDER BY p.set_code, p.id`
    )
    .all(setName) as PoolRow[]
  return rows.map((r) => ({
    pkey: r.pkey,
    cardId: r.card_id,
    name: r.name,
    setCode: r.set_code,
    rarity: canonicalRarity(r.set_rarity),
    variant: r.variant,
    frameType: r.frame_type,
    imageId: r.image_id
  }))
}

/** English sets with a researched layout whose pool fills every slot, newest first. */
export function ripSets(db: SqlDb, layouts: LayoutMap = RIP_SET_LAYOUTS): RipSet[] {
  const out: RipSet[] = []
  for (const s of listSets(db, YGO)) {
    if (s.language !== 'en') continue
    const layout = layoutFor(s.setCode, layouts)
    if (!layout || sharesCode(s.setName, layout) || !canFill(layout, ripPool(db, s.setName)))
      continue
    out.push({
      setName: s.setName,
      setCode: s.setCode,
      tcgDate: s.tcgDate,
      imageKey: s.imageKey,
      packImageKey: s.packImageKey,
      logoImageKey: s.logoImageKey,
      coverImageId: s.coverImageId,
      layoutLabel: layout.label,
      packLine: describeLayout(layout)
    })
  }
  return out.sort((a, b) =>
    (a.tcgDate ?? '') === (b.tcgDate ?? '')
      ? a.setName.localeCompare(b.setName)
      : (a.tcgDate ?? '') < (b.tcgDate ?? '')
        ? 1
        : -1
  )
}

/** Begin a session of `packCount` packs of a set; returns its id. Nothing is rolled yet. */
export function startRip(
  db: SqlDb,
  setName: string,
  packCount: number,
  now: Date,
  layouts: LayoutMap = RIP_SET_LAYOUTS
): number {
  if (!Number.isInteger(packCount) || packCount < 1 || packCount > MAX_PACKS) {
    throw new Error(`Pack count must be a whole number from 1 to ${MAX_PACKS}`)
  }
  // Validate only this set: building every set's summary (ownership counts, covers) costs ~1 s.
  const row = db
    .prepare(
      `SELECT s.set_code AS s_code, MIN(p.set_code) AS min_code
       FROM card_printings p
       LEFT JOIN sets s ON s.game = p.game AND s.language = p.language AND s.set_name = p.set_name
       WHERE p.game = 'ygo' AND p.language = 'en' AND p.contributed = 0 AND p.set_name = ?`
    )
    .get(setName) as { s_code: string | null; min_code: string | null } | undefined
  const setCode = row?.s_code ?? (row?.min_code ? setPrefix(row.min_code) : null)
  const layout = setCode ? layoutFor(setCode, layouts) : null
  if (
    !setCode ||
    !layout ||
    sharesCode(setName, layout) ||
    !canFill(layout, ripPool(db, setName))
  ) {
    throw new Error(`${setName} can't be ripped`)
  }
  const info = db
    .prepare(
      'INSERT INTO rip_sessions (set_name, set_code, pack_count, started_at) VALUES (?, ?, ?, ?)'
    )
    .run(setName, setCode, packCount, now.toISOString())
  return Number(info.lastInsertRowid)
}

/** Roll and save a session's next pack, in one transaction. Throws once all packs are opened. */
export function openPack(
  db: SqlDb,
  sessionId: number,
  rand?: () => number,
  layouts: LayoutMap = RIP_SET_LAYOUTS
): RipCard[] {
  return db.transaction(() => {
    const session = db
      .prepare('SELECT set_name, set_code, pack_count FROM rip_sessions WHERE id = ?')
      .get(sessionId) as { set_name: string; set_code: string; pack_count: number } | undefined
    if (!session) throw new Error(`No rip session ${sessionId}`)
    const opened = (
      db
        .prepare('SELECT COUNT(DISTINCT pack) AS n FROM rip_pulls WHERE session_id = ?')
        .get(sessionId) as {
        n: number
      }
    ).n
    if (opened >= session.pack_count) throw new Error('All packs in this session are opened')
    const layout = layoutFor(session.set_code, layouts)
    if (!layout) throw new Error(`No pack layout for ${session.set_name}`)
    const pack = rollPack(
      layout,
      ripPool(db, session.set_name),
      rand ?? mulberry32(Date.now() ^ sessionId)
    )
    const insert = db.prepare(
      `INSERT INTO rip_pulls (session_id, pack, slot, pkey, card_id, name, set_code, rarity, variant, frame_type, image_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    for (const c of pack) {
      insert.run(
        sessionId,
        opened,
        c.slot,
        c.pkey,
        c.cardId,
        c.name,
        c.setCode,
        c.rarity,
        c.variant,
        c.frameType,
        c.imageId
      )
    }
    return pack
  })()
}

interface PullRow {
  session_id: number
  pack: number
  slot: number
  pkey: string
  card_id: number
  name: string
  set_code: string
  rarity: string
  variant: string | null
  frame_type: string
  image_id: number | null
}

const toCard = (r: PullRow): RipCard => ({
  pkey: r.pkey,
  cardId: r.card_id,
  name: r.name,
  setCode: r.set_code,
  rarity: r.rarity,
  variant: r.variant,
  frameType: r.frame_type,
  imageId: r.image_id,
  slot: r.slot
})

interface SessionRow {
  id: number
  set_name: string
  set_code: string
  pack_count: number
  started_at: string
}

/** Rarest card first; among equals, the later pack (then lower slot) wins. */
const byBest = (a: PullRow, b: PullRow): number =>
  compareRarity(a.rarity, b.rarity) || b.pack - a.pack || a.slot - b.slot

function summarise(s: SessionRow, pulls: PullRow[]): RipSessionSummary {
  const best = pulls.length > 0 ? [...pulls].sort(byBest)[0] : null
  return {
    id: s.id,
    setName: s.set_name,
    setCode: s.set_code,
    packCount: s.pack_count,
    packsOpened: new Set(pulls.map((p) => p.pack)).size,
    startedAt: s.started_at,
    best: best ? toCard(best) : null
  }
}

const pullsOf = (db: SqlDb, sessionId: number): PullRow[] =>
  db
    .prepare('SELECT * FROM rip_pulls WHERE session_id = ? ORDER BY pack, slot')
    .all(sessionId) as PullRow[]

export function ripSession(db: SqlDb, id: number): RipSessionDetail | null {
  const s = db.prepare('SELECT * FROM rip_sessions WHERE id = ?').get(id) as SessionRow | undefined
  if (!s) return null
  const pulls = pullsOf(db, id)
  const packs: RipCard[][] = []
  for (const p of pulls) (packs[p.pack] ??= []).push(toCard(p))
  return { ...summarise(s, pulls), packs }
}

/** Totals, the rarest pulls ever (revealing rarities only), and recent sessions, newest first. */
export function ripHistory(
  db: SqlDb,
  opts: { bestLimit?: number; sessionLimit?: number; sessionOffset?: number } = {}
): RipHistory {
  const { bestLimit = 12, sessionLimit = 50, sessionOffset = 0 } = opts
  const totals = db
    .prepare(
      `SELECT COUNT(*) AS cards, COUNT(DISTINCT session_id || '|' || pack) AS packs,
              COUNT(DISTINCT s.set_name) AS sets
       FROM rip_pulls r JOIN rip_sessions s ON s.id = r.session_id`
    )
    .get() as { cards: number; packs: number; sets: number }
  const everything = db
    .prepare('SELECT * FROM rip_pulls ORDER BY session_id DESC, pack DESC, slot')
    .all() as PullRow[]
  const bestPulls = everything
    .filter((r) => tierFor(r.rarity, r.set_code) !== 'none')
    .sort((a, b) => compareRarity(a.rarity, b.rarity)) // stable: newest first within a rarity
    .slice(0, Math.max(0, bestLimit))
    .map(toCard)
  const sessions = (
    db
      .prepare(
        `SELECT * FROM rip_sessions s
         WHERE EXISTS (SELECT 1 FROM rip_pulls r WHERE r.session_id = s.id)
         ORDER BY id DESC LIMIT ? OFFSET ?`
      )
      .all(Math.max(0, sessionLimit), Math.max(0, sessionOffset)) as SessionRow[]
  ).map((s) => summarise(s, pullsOf(db, s.id)))
  return {
    packsOpened: totals.packs,
    cardsPulled: totals.cards,
    setsRipped: totals.sets,
    bestPulls,
    sessions
  }
}
