import type { SqlDb } from '../../../src/main/db/sql'
import { CollectionError } from '../../../src/main/repo/collection'
import { recordSnapshot } from '../../../src/main/repo/stats'
import { settleWishlist } from '../../../src/main/repo/wishlist'
import type { CardChoice, MergeChoice } from '../../../src/shared/account'
import type { Me } from '../../../src/shared/cloud'
import { isGameId } from '../../../src/shared/games'
import type { AppDeps } from './app'
import { deleteUserData } from './account'
import { loadMe, sha256Hex } from './auth'
import { planCardMerge } from './mergePlan'
import {
  NEXT_BINDER_EDIT_SEQ,
  NEXT_BINDER_SEQ,
  NEXT_FAVOURITE_SEQ,
  NEXT_SEQ,
  NEXT_WISH_SEQ,
  userScope
} from './scope'
import { findAccount, refreshLegacyDiscordId, type Identity } from './signIns'

/** How long a closed account's data is held, so the owner can undo a bad merge. */
export const MERGE_HOLD_MS = 30 * 24 * 60 * 60 * 1000

const CHOICES: readonly CardChoice[] = ['higher', 'mine', 'theirs', 'sum']
const STALE_TICKET = 'This link expired. Try linking again.'

export interface MergeArgs {
  survivor: number
  closed: number
  cards: CardChoice
  username: 'mine' | 'theirs'
  /** The sign-in whose link found `closed`. */
  moved: Identity
  /** A refresh token the link's Sign in with Apple brought, kept if `closed` had none. */
  appleRefreshToken: string | null
  now: Date
}

const providersOf = (db: SqlDb, userId: number): string[] =>
  (
    db.prepare('SELECT provider FROM sign_ins WHERE user_id = ?').all(userId) as {
      provider: string
    }[]
  ).map((r) => r.provider)

/** Step 1: `closed`'s cards into `survivor`'s, as planCardMerge planned them. */
function mergeCards(db: SqlDb, a: MergeArgs, nowIso: string): void {
  const ops = planCardMerge(db, a.survivor, a.closed, a.cards)
  // Copies the source row's game and fields; only the uid, owner, update time and seq are new.
  const insert = db.prepare(
    `INSERT INTO collection_entries (user_id, uid, game, printing_id, image_id, quantity, notes,
       created_at, updated_at, server_seq)
     SELECT ?, ?, game, printing_id, image_id, quantity, notes, created_at, ?, ${NEXT_SEQ}
       FROM collection_entries WHERE id = ?`
  )
  const update = db.prepare(
    `UPDATE collection_entries
        SET quantity = ?,
            notes = CASE WHEN notes = '' THEN (SELECT notes FROM collection_entries WHERE uid = ?) ELSE notes END,
            updated_at = ?, server_seq = ${NEXT_SEQ}
      WHERE id = ? AND user_id = ? AND deleted_at IS NULL`
  )
  const tombstone = db.prepare(
    `UPDATE collection_entries SET deleted_at = ?, updated_at = ?, server_seq = ${NEXT_SEQ}
      WHERE id = ? AND user_id = ? AND deleted_at IS NULL`
  )
  for (const op of ops) {
    const changes =
      op.kind === 'insert'
        ? insert.run(a.survivor, crypto.randomUUID(), nowIso, op.from.id).changes
        : op.kind === 'update'
          ? update.run(op.quantity, op.fromUid, nowIso, op.id, a.survivor).changes
          : tombstone.run(nowIso, nowIso, op.id, a.survivor).changes
    // The plan was made in this transaction, so every op finds its row; anything else is a bug.
    if (changes !== 1) throw new Error(`Merge card op ${op.kind} changed ${changes} rows`)
  }
}

/** The larger wanted count; a count beats no target. */
const higherWant = (x: number | null, y: number | null): number | null =>
  x === null ? y : y === null ? x : Math.max(x, y)

/** Step 2: the union of both wishlists by printing key, keeping the higher count. */
function mergeWishlist(db: SqlDb, a: MergeArgs, nowIso: string): void {
  type Wish = { pkey: string; game: string; quantity: number | null; created_at: string }
  type Own = { quantity: number | null; deleted_at: string | null }
  const theirs = db
    .prepare(
      'SELECT pkey, game, quantity, created_at FROM wishlist_entries WHERE user_id = ? AND deleted_at IS NULL'
    )
    .all(a.closed) as Wish[]
  const mine = db.prepare(
    'SELECT quantity, deleted_at FROM wishlist_entries WHERE user_id = ? AND pkey = ?'
  )
  const upsert = db.prepare(
    `INSERT INTO wishlist_entries (user_id, pkey, game, quantity, created_at, updated_at, seq)
     VALUES (?, ?, ?, ?, ?, ?, ${NEXT_WISH_SEQ})
     ON CONFLICT(user_id, pkey) DO UPDATE SET quantity = excluded.quantity,
       game = CASE WHEN deleted_at IS NULL THEN game ELSE excluded.game END,
       created_at = CASE WHEN deleted_at IS NULL THEN created_at ELSE excluded.created_at END,
       updated_at = excluded.updated_at, deleted_at = NULL, seq = ${NEXT_WISH_SEQ}`
  )
  for (const w of theirs) {
    const own = mine.get(a.survivor, w.pkey) as Own | undefined
    const live = own !== undefined && own.deleted_at === null
    const quantity = live ? higherWant(own.quantity, w.quantity) : w.quantity
    if (live && quantity === own.quantity) continue
    upsert.run(a.survivor, w.pkey, w.game, quantity, w.created_at, nowIso)
  }
}

/** Step 3: the union of both accounts' favourites. */
function mergeFavourites(db: SqlDb, a: MergeArgs, nowIso: string): void {
  const theirs = db
    .prepare(
      `SELECT f.card_id, f.game, f.created_at FROM favourites f
        WHERE f.user_id = ? AND f.deleted_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM favourites m WHERE m.user_id = ? AND m.card_id = f.card_id
                            AND m.deleted_at IS NULL)`
    )
    .all(a.closed, a.survivor) as { card_id: number; game: string; created_at: string }[]
  const upsert = db.prepare(
    `INSERT INTO favourites (user_id, card_id, game, created_at, updated_at, seq)
     VALUES (?, ?, ?, ?, ?, ${NEXT_FAVOURITE_SEQ})
     ON CONFLICT(user_id, card_id) DO UPDATE SET game = excluded.game,
       created_at = excluded.created_at, updated_at = excluded.updated_at, deleted_at = NULL,
       seq = ${NEXT_FAVOURITE_SEQ}`
  )
  for (const f of theirs) upsert.run(a.survivor, f.card_id, f.game, f.created_at, nowIso)
}

/**
 * Step 4: copies `closed`'s live binders and their live edits, keeping uids. A name the survivor
 * already uses in that game gets ` (2)`, ` (3)`, ... A uid the survivor already has live is the
 * same binder (one device synced both accounts), so it's left as the survivor has it.
 */
function mergeBinders(db: SqlDb, a: MergeArgs, nowIso: string): void {
  type Binder = { uid: string; game: string; name: string }
  const taken = new Set(
    (
      db
        .prepare('SELECT game, name FROM binders WHERE user_id = ? AND deleted_at IS NULL')
        .all(a.survivor) as { game: string; name: string }[]
    ).map((b) => `${b.game}\n${b.name}`)
  )
  const liveUids = new Set(
    (
      db
        .prepare('SELECT uid FROM binders WHERE user_id = ? AND deleted_at IS NULL')
        .all(a.survivor) as { uid: string }[]
    ).map((b) => b.uid)
  )
  const theirs = db
    .prepare(
      `SELECT uid, game, name FROM binders WHERE user_id = ? AND deleted_at IS NULL
        ORDER BY sort_order, created_at, uid`
    )
    .all(a.closed) as Binder[]
  const copy = db.prepare(
    `INSERT INTO binders (user_id, uid, game, name, rules, goal, languages, friends_visible,
       sort_order, created_at, updated_at, seq)
     SELECT ?, uid, game, ?, rules, goal, languages, friends_visible, sort_order, created_at, ?,
       ${NEXT_BINDER_SEQ}
       FROM binders WHERE user_id = ? AND uid = ?
     ON CONFLICT(user_id, uid) DO UPDATE SET game = excluded.game, name = excluded.name,
       rules = excluded.rules, goal = excluded.goal, languages = excluded.languages,
       friends_visible = excluded.friends_visible, sort_order = excluded.sort_order,
       created_at = excluded.created_at, updated_at = excluded.updated_at, deleted_at = NULL,
       seq = ${NEXT_BINDER_SEQ}`
  )
  const edits = db.prepare(
    `SELECT level, target FROM binder_edits WHERE user_id = ? AND binder_uid = ? AND deleted_at IS NULL`
  )
  const copyEdit = db.prepare(
    `INSERT INTO binder_edits (user_id, binder_uid, level, target, game, action, created_at,
       updated_at, seq)
     SELECT ?, binder_uid, level, target, game, action, created_at, ?, ${NEXT_BINDER_EDIT_SEQ}
       FROM binder_edits WHERE user_id = ? AND binder_uid = ? AND level = ? AND target = ?
     ON CONFLICT(user_id, binder_uid, level, target) DO UPDATE SET game = excluded.game,
       action = excluded.action, created_at = excluded.created_at,
       updated_at = excluded.updated_at, deleted_at = NULL, seq = ${NEXT_BINDER_EDIT_SEQ}`
  )
  for (const b of theirs) {
    if (liveUids.has(b.uid)) continue
    let name = b.name
    for (let n = 2; taken.has(`${b.game}\n${name}`); n++) name = `${b.name} (${n})`
    taken.add(`${b.game}\n${name}`)
    copy.run(a.survivor, name, nowIso, a.closed, b.uid)
    for (const e of edits.all(a.closed, b.uid) as { level: string; target: string }[])
      copyEdit.run(a.survivor, nowIso, a.closed, b.uid, e.level, e.target)
  }
}

/**
 * Step 5: `closed`'s friendships, requests and blocks move to `survivor`. A friendship beats a
 * pending request, a block beats both, and anything between the two accounts disappears. Then
 * `closed`'s own rows are deleted, so no one sees the closed account any more.
 */
function mergeFriends(db: SqlDb, a: MergeArgs, nowIso: string): void {
  const { survivor: s, closed: c } = a
  type Friendship = {
    requester_id: number
    addressee_id: number
    status: string
    created_at: string
  }
  const theirs = db
    .prepare(
      `SELECT requester_id, addressee_id, status, created_at FROM friendships
        WHERE requester_id = ? OR addressee_id = ?`
    )
    .all(c, c) as Friendship[]
  const between = db.prepare(
    `SELECT requester_id, status FROM friendships
      WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)`
  )
  const insert = db.prepare(
    `INSERT INTO friendships (requester_id, addressee_id, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`
  )
  const accept = db.prepare(
    `UPDATE friendships SET status = 'accepted', updated_at = ?
      WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)`
  )
  for (const f of theirs) {
    const other = f.requester_id === c ? f.addressee_id : f.requester_id
    if (other === s) continue
    const own = between.get(s, other, other, s) as { status: string } | undefined
    if (!own) {
      const [req, addr] = f.requester_id === c ? [s, other] : [other, s]
      insert.run(req, addr, f.status, f.created_at, nowIso)
    } else if (own.status === 'pending' && f.status === 'accepted') {
      accept.run(nowIso, s, other, other, s)
    }
  }

  const blocks = db
    .prepare(
      'SELECT blocker_id, blocked_id, created_at FROM friend_blocks WHERE blocker_id = ? OR blocked_id = ?'
    )
    .all(c, c) as { blocker_id: number; blocked_id: number; created_at: string }[]
  const block = db.prepare(
    'INSERT OR IGNORE INTO friend_blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)'
  )
  for (const b of blocks) {
    const blocker = b.blocker_id === c ? s : b.blocker_id
    const blocked = b.blocked_id === c ? s : b.blocked_id
    if (blocker !== blocked) block.run(blocker, blocked, b.created_at)
  }
  // A block wins over any friendship or request with the same person, as blockUser does.
  const partners = db
    .prepare(
      `SELECT CASE WHEN blocker_id = ? THEN blocked_id ELSE blocker_id END AS id FROM friend_blocks
        WHERE blocker_id = ? OR blocked_id = ?`
    )
    .all(s, s, s) as { id: number }[]
  const unfriend = db.prepare(
    `DELETE FROM friendships
      WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)`
  )
  for (const p of partners) unfriend.run(s, p.id, p.id, s)

  db.prepare('DELETE FROM friendships WHERE requester_id = ? OR addressee_id = ?').run(c, c)
  db.prepare('DELETE FROM friend_blocks WHERE blocker_id = ? OR blocked_id = ?').run(c, c)
}

/** Step 6: every sign-in of `closed` moves to `survivor`, with its Apple refresh token. */
function moveSignIns(
  db: SqlDb,
  a: MergeArgs,
  nowIso: string
): { moved: Identity[]; appleToken: boolean } {
  const moved = db
    .prepare('SELECT provider, subject FROM sign_ins WHERE user_id = ? ORDER BY provider, subject')
    .all(a.closed) as Identity[]
  db.prepare('UPDATE sign_ins SET user_id = ? WHERE user_id = ?').run(a.survivor, a.closed)
  const theirs = db
    .prepare('SELECT refresh_token FROM apple_tokens WHERE user_id = ?')
    .get(a.closed) as { refresh_token: string } | undefined
  const token = theirs?.refresh_token ?? a.appleRefreshToken
  if (token === null) return { moved, appleToken: false }
  db.prepare('DELETE FROM apple_tokens WHERE user_id = ?').run(a.closed)
  db.prepare(
    `INSERT INTO apple_tokens (user_id, refresh_token, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (user_id) DO UPDATE SET refresh_token = excluded.refresh_token,
       updated_at = excluded.updated_at`
  ).run(a.survivor, token, nowIso)
  return { moved, appleToken: true }
}

/** A free name for the closed account when the survivor takes its username. */
function closedName(db: SqlDb, closed: number): string {
  const free = (name: string): boolean =>
    db.prepare('SELECT 1 FROM users WHERE username = ? COLLATE NOCASE').get(name) === undefined
  const base = `merged-${closed}`
  if (free(base)) return base
  for (let n = 2; ; n++) if (free(`${base}-${n}`)) return `${base}-${n}`
}

function applyMerge(db: SqlDb, a: MergeArgs): void {
  if (a.survivor === a.closed) throw new Error('An account cannot merge into itself')
  if (findAccount(db, a.moved) !== a.closed)
    throw new Error("The moved sign-in isn't the closed account's")
  const nowIso = a.now.toISOString()

  mergeCards(db, a, nowIso)
  mergeWishlist(db, a, nowIso)
  mergeFavourites(db, a, nowIso)
  mergeBinders(db, a, nowIso)
  mergeFriends(db, a, nowIso)
  const { moved, appleToken } = moveSignIns(db, a, nowIso)

  const { username: closedUsername } = db
    .prepare('SELECT username FROM users WHERE id = ?')
    .get(a.closed) as { username: string }
  if (a.username === 'theirs') {
    db.prepare('UPDATE users SET username = ? WHERE id = ?').run(closedName(db, a.closed), a.closed)
    db.prepare('UPDATE users SET username = ?, username_chosen = 1 WHERE id = ?').run(
      closedUsername,
      a.survivor
    )
  }

  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(a.closed)
  db.prepare('DELETE FROM desktop_codes WHERE user_id = ?').run(a.closed)
  db.prepare('UPDATE users SET closed_at = ?, updated_at = ? WHERE id = ?').run(
    nowIso,
    nowIso,
    a.closed
  )
  db.prepare('UPDATE users SET updated_at = ? WHERE id = ?').run(nowIso, a.survivor)
  // Closed first: it gives up the Discord id the survivor's legacy id may now take.
  refreshLegacyDiscordId(db, a.closed)
  refreshLegacyDiscordId(db, a.survivor)

  db.prepare(
    `INSERT INTO account_merges (closed_id, survivor_id, merged_at, purge_after, cards,
       closed_username, moved_sign_ins, moved_apple_token) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    a.closed,
    a.survivor,
    nowIso,
    new Date(a.now.getTime() + MERGE_HOLD_MS).toISOString(),
    a.cards,
    closedUsername,
    JSON.stringify(moved.map((m) => ({ provider: m.provider, subject: m.subject }))),
    appleToken ? 1 : 0
  )

  const games = (
    db
      .prepare('SELECT DISTINCT game FROM collection_entries WHERE user_id = ?')
      .all(a.survivor) as { game: string }[]
  )
    .map((r) => r.game)
    .filter(isGameId)
  for (const game of games) {
    const scope = userScope(a.survivor, game)
    settleWishlist(db, scope, a.now)
    recordSnapshot(db, a.now, scope)
  }
}

/**
 * Merges `closed` into `survivor`, in one transaction: cards under `cards`, then wishlists,
 * favourites, binders, friends and sign-ins; `username: 'theirs'` gives the survivor the closed
 * account's name. Every row it writes for the survivor takes a new seq, so the survivor's devices
 * pull it. `closed` is signed out everywhere and closed; its own rows are left as they were, held
 * until `purgeHolds` deletes them after 30 days. The caller checks the two may merge.
 */
export function mergeAccounts(db: SqlDb, args: MergeArgs): void {
  db.transaction(() => applyMerge(db, args))()
}

/** Every account merged into `userId`, and into those, and so on: purged ones included. */
export function mergedFrom(db: SqlDb, userId: number): number[] {
  const into = db.prepare('SELECT closed_id FROM account_merges WHERE survivor_id = ?')
  const seen = new Set([userId])
  const out: number[] = []
  for (let i = -1; i < out.length; i++) {
    const id = i < 0 ? userId : out[i]
    for (const { closed_id } of into.all(id) as { closed_id: number }[]) {
      if (seen.has(closed_id)) continue
      seen.add(closed_id)
      out.push(closed_id)
    }
  }
  return out
}

/** Deletes the data of every closed account whose hold is over; their merge rows stay, stamped. */
export function purgeHolds(db: SqlDb, now: Date): void {
  const nowIso = now.toISOString()
  const due = db
    .prepare(
      'SELECT closed_id FROM account_merges WHERE purged_at IS NULL AND purge_after <= ? ORDER BY purge_after'
    )
    .all(nowIso) as { closed_id: number }[]
  const stamp = db.prepare('UPDATE account_merges SET purged_at = ? WHERE closed_id = ?')
  for (const { closed_id } of due) {
    deleteUserData(db, closed_id)
    stamp.run(nowIso, closed_id)
  }
}

function checkChoice(v: unknown): MergeChoice {
  const c = v as Partial<MergeChoice> | null
  if (
    c === null ||
    typeof c !== 'object' ||
    Array.isArray(c) ||
    !CHOICES.includes(c.cards as CardChoice) ||
    (c.username !== 'mine' && c.username !== 'theirs')
  )
    throw new CollectionError(
      'Choose cards (higher, mine, theirs or sum) and username (mine or theirs)'
    )
  return { cards: c.cards as CardChoice, username: c.username }
}

/**
 * `account:merge(ticket, { cards, username })`: merges the account a link's merge ticket found
 * into the signed-in one, and answers the signed-in account's `Me`. The ticket is spent whatever
 * happens, and a merge spends the caller's other tickets. Answers "This link expired" when the
 * ticket is unknown, past its 15 minutes, someone else's, or no longer true: its sign-in moved, the
 * other account closed, or the two accounts now share a provider.
 */
export async function mergeWithTicket(
  deps: AppDeps,
  userId: number,
  ticket: unknown,
  choice: unknown
): Promise<Me> {
  const { cards, username } = checkChoice(choice)
  if (typeof ticket !== 'string' || ticket.length === 0 || ticket.length > 128)
    throw new CollectionError(STALE_TICKET)
  const ticketHash = await sha256Hex(ticket)
  const { db } = deps
  const now = deps.now()
  const nowIso = now.toISOString()
  const done = db.transaction((): boolean => {
    const row = db
      .prepare(
        `SELECT user_id, other_id, provider, subject, apple_refresh_token, expires_at
           FROM merge_tickets WHERE ticket_hash = ?`
      )
      .get(ticketHash) as
      | {
          user_id: number
          other_id: number
          provider: Identity['provider']
          subject: string
          apple_refresh_token: string | null
          expires_at: string
        }
      | undefined
    db.prepare('DELETE FROM merge_tickets WHERE ticket_hash = ?').run(ticketHash)
    if (!row || row.expires_at <= nowIso || row.user_id !== userId || row.other_id === userId)
      return false
    const moved: Identity = { provider: row.provider, subject: row.subject }
    // findAccount skips closed accounts, so this also refuses a closed other account.
    if (findAccount(db, moved) !== row.other_id) return false
    const mine = providersOf(db, userId)
    if (providersOf(db, row.other_id).some((p) => mine.includes(p))) return false

    applyMerge(db, {
      survivor: userId,
      closed: row.other_id,
      cards,
      username,
      moved,
      appleRefreshToken: row.provider === 'apple' ? row.apple_refresh_token : null,
      now
    })
    db.prepare('DELETE FROM merge_tickets WHERE user_id IN (?, ?) OR other_id = ?').run(
      userId,
      row.other_id,
      row.other_id
    )
    return true
  })()
  if (!done) throw new CollectionError(STALE_TICKET)
  return loadMe(deps, userId)
}
