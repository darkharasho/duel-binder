import type { SqlDb } from '../../../src/main/db/sql'
import { labelOf } from '../../../src/main/repo/explainQuery'
import { forgetSearchTerms, termPrintingIds } from '../../../src/main/repo/searchTerms'
import { isGameId, type GameId } from '../../../src/shared/games'
import {
  MAX_TERM_WORDS,
  TERM_KINDS,
  TERM_TARGET_KINDS,
  confineTarget,
  termKey,
  termWords,
  type SearchTerm,
  type TermEvidence,
  type TermFeed,
  type TermKind,
  type TermTarget,
  type TermTargetKind,
  type WireTerm
} from '../../../src/shared/search/terms'
import type { AppDeps } from './app'
import { adminWriteAllowed, isAdmin, isJson } from './auth'
import { userScope } from './scope'
import { adminAuthorized } from './thumbs'

const PAGE = 500
const MAX_PROPOSALS = 100
const MAX_PHRASE = 80
const KINDS: readonly string[] = TERM_KINDS
const TARGET_KINDS: readonly string[] = TERM_TARGET_KINDS

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const bad = (): Response => json({ error: 'Bad request' }, 400)

interface Row {
  id: number
  game: string
  phrase: string
  phrase_key: string
  kind: string
  target_kind: string
  target: string
  status: string
  source: string
  evidence: string
  seq: number
  decided_at?: string | null
}

const NEXT_SEQ = '(SELECT COALESCE(MAX(seq), 0) + 1 FROM search_terms)'

function parse<T>(text: string, fallback: T): T {
  try {
    const v = JSON.parse(text)
    return v && typeof v === 'object' ? (v as T) : fallback
  } catch {
    return fallback
  }
}

/** Terms approved after `since` and ids that left approved after it, one page in seq order. */
export function termFeed(db: SqlDb, game: GameId, since: number): TermFeed {
  const rows = db
    .prepare(
      `SELECT id, game, phrase, phrase_key, kind, target_kind, target, status, seq, decided_at
       FROM search_terms WHERE game = ? AND seq > ? ORDER BY seq ASC LIMIT ?`
    )
    .all(game, since, PAGE + 1) as Row[]
  const more = rows.length > PAGE
  const page = more ? rows.slice(0, PAGE) : rows
  const terms: WireTerm[] = []
  const deleted: number[] = []
  for (const r of page) {
    if (r.status === 'approved')
      terms.push({
        id: r.id,
        game: r.game as GameId,
        phrase: r.phrase,
        phraseKey: r.phrase_key,
        kind: r.kind as TermKind,
        targetKind: r.target_kind as TermTargetKind,
        target: parse<TermTarget>(r.target, {}),
        seq: r.seq
      })
    // A row never decided (pending) was never sent, so a device has nothing to delete.
    else if (r.decided_at) deleted.push(r.id)
  }
  return { terms, deleted, cursor: page.length ? page[page.length - 1].seq : since, more }
}

interface Fields {
  phrase: string
  kind: TermKind
  targetKind: TermTargetKind
  target: TermTarget
}

const isStrings = (v: unknown): boolean => Array.isArray(v) && v.every((x) => typeof x === 'string')

function checkTarget(t: unknown): TermTarget | null {
  if (!t || typeof t !== 'object' || Array.isArray(t)) return null
  const o = t as Record<string, unknown>
  if (o.pkeys !== undefined && !isStrings(o.pkeys)) return null
  if (o.rarities !== undefined && !isStrings(o.rarities)) return null
  if (
    o.cardIds !== undefined &&
    !(Array.isArray(o.cardIds) && o.cardIds.every((x) => Number.isSafeInteger(x)))
  )
    return null
  if (
    o.sets !== undefined &&
    !(
      Array.isArray(o.sets) &&
      o.sets.every((s) => s && typeof s.language === 'string' && typeof s.setName === 'string')
    )
  )
    return null
  return {
    ...(o.pkeys ? { pkeys: o.pkeys as string[] } : {}),
    ...(o.cardIds ? { cardIds: o.cardIds as number[] } : {}),
    ...(o.sets
      ? {
          sets: (o.sets as { language: string; setName: string }[]).map((s) => ({
            language: s.language,
            setName: s.setName
          }))
        }
      : {}),
    ...(o.rarities ? { rarities: o.rarities as string[] } : {})
  }
}

function checkPhrase(p: unknown): string | null {
  if (typeof p !== 'string' || p.length > MAX_PHRASE) return null
  const n = termWords(p).length
  return n >= 1 && n <= MAX_TERM_WORDS ? p.trim() : null
}

/**
 * The one gate for propose, add and decide. The target keeps only the list its kind names (searches
 * read only that one, so another would narrow the term where the review list can't show it), and
 * that list must not be empty.
 */
function checkFields(b: Record<string, unknown>): Fields | null {
  const phrase = checkPhrase(b.phrase)
  const target = checkTarget(b.target)
  if (
    phrase === null ||
    !target ||
    typeof b.kind !== 'string' ||
    !KINDS.includes(b.kind) ||
    typeof b.targetKind !== 'string' ||
    !TARGET_KINDS.includes(b.targetKind)
  )
    return null
  const targetKind = b.targetKind as TermTargetKind
  const confined = confineTarget(targetKind, target)
  if (Object.keys(confined).length === 0) return null
  return { phrase, kind: b.kind as TermKind, targetKind, target: confined }
}

function checkEvidence(e: unknown): TermEvidence | null {
  if (!e || typeof e !== 'object') return null
  const o = e as Record<string, unknown>
  if (
    !isStrings(o.titles) ||
    !Number.isSafeInteger(o.count) ||
    !Number.isSafeInteger(o.sellers) ||
    typeof o.reason !== 'string'
  )
    return null
  return {
    titles: (o.titles as string[]).slice(0, 20),
    count: o.count as number,
    sellers: o.sellers as number,
    reason: o.reason.slice(0, 500)
  }
}

function wire(r: Row): SearchTerm {
  return {
    id: r.id,
    game: r.game as GameId,
    phrase: r.phrase,
    phraseKey: r.phrase_key,
    kind: r.kind as TermKind,
    targetKind: r.target_kind as TermTargetKind,
    target: parse<TermTarget>(r.target, {}),
    status: r.status as SearchTerm['status'],
    source: r.source as SearchTerm['source'],
    seq: r.seq
  }
}

/** The first card a term names, for the review list; null when nothing matches locally. */
function preview(
  db: SqlDb,
  term: SearchTerm
): { cardName: string; imageId: number | null; label: string } | null {
  const scope = userScope(0, term.game)
  const label = labelOf(db, scope, term)
  if (!label) return null
  let cardId: number | undefined
  if (term.targetKind === 'card' || term.targetKind === 'cards') cardId = term.target.cardIds?.[0]
  else {
    const [pid] = termPrintingIds(db, scope, term, 1)
    if (pid !== undefined)
      cardId = (
        db.prepare('SELECT card_id FROM card_printings WHERE id = ?').get(pid) as
          { card_id: number } | undefined
      )?.card_id
  }
  const card =
    cardId === undefined
      ? undefined
      : (db.prepare('SELECT name FROM cards WHERE id = ?').get(cardId) as
          { name: string } | undefined)
  const image =
    cardId === undefined
      ? undefined
      : (db
          .prepare('SELECT image_id FROM card_images WHERE card_id = ? ORDER BY sort_order LIMIT 1')
          .get(cardId) as { image_id: number } | undefined)
  return { cardName: card?.name ?? label, imageId: image?.image_id ?? null, label }
}

/**
 * 409 for a phrase another term of the game already uses; the error names that term's status
 * (`duplicate-rejected`, say) so the admin pages can say where to find it.
 */
function duplicate(db: SqlDb, game: string, key: string, notId = -1): Response {
  const other = db
    .prepare('SELECT status FROM search_terms WHERE game = ? AND phrase_key = ? AND id != ?')
    .get(game, key, notId) as { status: string } | undefined
  return json({ error: other ? `duplicate-${other.status}` : 'duplicate' }, 409)
}

const SELECT = `SELECT id, game, phrase, phrase_key, kind, target_kind, target, status, source,
  evidence, seq FROM search_terms`

function insert(
  db: SqlDb,
  game: GameId,
  f: Fields,
  status: string,
  source: string,
  evidence: TermEvidence | null,
  now: string
): number {
  return db
    .prepare(
      `INSERT INTO search_terms (game, phrase, phrase_key, kind, target_kind, target, status, source,
         evidence, seq, created_at, decided_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ${NEXT_SEQ}, ?, ?)
       ON CONFLICT(game, phrase_key) DO NOTHING`
    )
    .run(
      game,
      f.phrase,
      termKey(f.phrase),
      f.kind,
      f.targetKind,
      JSON.stringify(f.target),
      status,
      source,
      JSON.stringify(evidence ?? {}),
      now,
      status === 'pending' ? null : now
    ).changes
}

/**
 * /admin/terms (list), /decide, /add (owner session, otherwise 404) and /propose, /known (admin
 * token, like the catalog routes).
 */
export async function adminTermsRoute(req: Request, deps: AppDeps): Promise<Response> {
  const { db } = deps
  const url = new URL(req.url)
  const path = url.pathname
  const notFound = json({ error: 'Not found' }, 404)

  if (path === '/admin/terms/propose' || path === '/admin/terms/known') {
    const wantGet = path === '/admin/terms/known'
    if (req.method !== (wantGet ? 'GET' : 'POST')) return json({ error: 'method-not-allowed' }, 405)
    if (!(await adminAuthorized(req, deps.env.ADMIN_TOKEN)))
      return json({ error: 'unauthorized' }, 401)
    if (wantGet) {
      const game = url.searchParams.get('game')
      if (!isGameId(game)) return bad()
      const rows = db.prepare('SELECT phrase_key FROM search_terms WHERE game = ?').all(game) as {
        phrase_key: string
      }[]
      return json({ keys: rows.map((r) => r.phrase_key) })
    }
    if (!isJson(req)) return json({ error: 'unsupported-media-type' }, 415)
    const body = (await req.json().catch(() => null)) as { proposals?: unknown } | null
    const list = body?.proposals
    if (!Array.isArray(list) || list.length > MAX_PROPOSALS) return bad()
    const checked: { game: GameId; f: Fields; evidence: TermEvidence }[] = []
    for (const p of list) {
      if (!p || typeof p !== 'object') return bad()
      const o = p as Record<string, unknown>
      const f = checkFields(o)
      const evidence = checkEvidence(o.evidence)
      if (!f || !evidence || !isGameId(o.game)) return bad()
      checked.push({ game: o.game, f, evidence })
    }
    const now = deps.now().toISOString()
    let added = 0
    for (const c of checked) added += insert(db, c.game, c.f, 'pending', 'ebay-ai', c.evidence, now)
    if (added > 0) forgetSearchTerms(db)
    return json({ added })
  }

  if (!(await isAdmin(req, deps))) return notFound

  if (req.method === 'GET' && path === '/admin/terms') {
    const status = url.searchParams.get('status') ?? 'pending'
    if (status !== 'pending' && status !== 'approved' && status !== 'rejected') return bad()
    const game = url.searchParams.get('game')
    if (game && !isGameId(game)) return bad()
    const rows = db
      .prepare(
        `${SELECT} WHERE status = ?${game ? ' AND game = ?' : ''} ORDER BY id DESC LIMIT 500`
      )
      .all(...(game ? [status, game] : [status])) as Row[]
    return json({
      terms: rows.map((r) => ({
        ...wire(r),
        evidence: parse<TermEvidence>(r.evidence, { titles: [], count: 0, sellers: 0, reason: '' }),
        preview: preview(db, wire(r))
      }))
    })
  }

  if (req.method !== 'POST' || (path !== '/admin/terms/decide' && path !== '/admin/terms/add'))
    return notFound
  if (!adminWriteAllowed(req, deps)) return notFound
  if (!isJson(req)) return json({ error: 'unsupported-media-type' }, 415)
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return bad()
  const now = deps.now().toISOString()

  if (path === '/admin/terms/add') {
    const f = checkFields(body)
    if (!f || !isGameId(body.game)) return bad()
    const changes = insert(db, body.game, f, 'approved', 'owner', null, now)
    forgetSearchTerms(db)
    return changes === 1 ? json({ ok: true }) : duplicate(db, body.game, termKey(f.phrase))
  }

  const { id, status } = body
  if (!Number.isInteger(id) || (status !== 'approved' && status !== 'rejected')) return bad()
  const row = db.prepare(`${SELECT} WHERE id = ?`).get(id) as Row | undefined
  if (!row) return notFound
  const edited = wire(row)
  const merged = checkFields({
    phrase: body.phrase ?? edited.phrase,
    kind: body.kind ?? edited.kind,
    targetKind: body.targetKind ?? edited.targetKind,
    target: body.target ?? edited.target
  })
  if (!merged) return bad()
  const key = termKey(merged.phrase)
  const clash = db
    .prepare('SELECT id FROM search_terms WHERE game = ? AND phrase_key = ? AND id != ?')
    .get(row.game, key, row.id)
  if (clash) return duplicate(db, row.game, key, row.id)
  db.prepare(
    `UPDATE search_terms SET phrase = ?, phrase_key = ?, kind = ?, target_kind = ?, target = ?,
       status = ?, decided_at = ?, seq = ${NEXT_SEQ} WHERE id = ?`
  ).run(
    merged.phrase,
    key,
    merged.kind,
    merged.targetKind,
    JSON.stringify(merged.target),
    status,
    now,
    row.id
  )
  forgetSearchTerms(db)
  return json({ ok: true })
}
