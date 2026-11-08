import type { SqlDb } from '../../../src/main/db/sql'
import { GAMES, isGameId } from '../../../src/shared/games'
import type { GameId } from '../../../src/shared/games'
import type { AppDeps } from './app'
import { adminWriteAllowed, isAdmin } from './auth'

/** The games this account is listed as a tester for (`game_testers`, server-36). */
export function testerGames(db: SqlDb, userId: number): GameId[] {
  const rows = db.prepare('SELECT game FROM game_testers WHERE user_id = ?').all(userId) as {
    game: string
  }[]
  return rows.map((r) => r.game).filter(isGameId)
}

/**
 * Binds the pending invites that name this Discord username (compared case-insensitively) to the
 * account that just attached that Discord identity. Only unbound rows (`user_id IS NULL`) are
 * touched, so a row already bound to another account is never taken. A pending row for a game the
 * account already holds can't bind (the unique index ignores it) and is dropped. Call inside a
 * transaction, with the username Discord just reported.
 */
export function bindTesterInvites(db: SqlDb, userId: number, discordUsername: string): void {
  db.prepare(
    `UPDATE OR IGNORE game_testers SET user_id = ?
      WHERE user_id IS NULL AND discord_username = ? COLLATE NOCASE`
  ).run(userId, discordUsername)
  db.prepare(
    `DELETE FROM game_testers
      WHERE user_id IS NULL AND discord_username = ? COLLATE NOCASE
        AND game IN (SELECT game FROM game_testers WHERE user_id = ?)`
  ).run(discordUsername, userId)
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

interface TesterRow {
  id: number
  game: GameId
  discordUsername: string | null
  userId: number | null
  username: string | null
}

const SELECT_ROWS = `SELECT t.id AS id, t.game AS game, t.discord_username AS discordUsername,
       t.user_id AS userId, u.username AS username
  FROM game_testers t LEFT JOIN users u ON u.id = t.user_id`

/** GET /admin/testers, POST /admin/testers and POST /admin/testers/remove; owner-only, otherwise 404. */
export async function adminTestersRoute(req: Request, deps: AppDeps): Promise<Response> {
  const { db } = deps
  const path = new URL(req.url).pathname
  const notFound = json({ error: 'Not found' }, 404)
  if (!(await isAdmin(req, deps))) return notFound
  if (req.method === 'GET' && path === '/admin/testers') {
    const testers = (
      db
        .prepare(
          `${SELECT_ROWS} ORDER BY t.game, COALESCE(u.username, t.discord_username) COLLATE NOCASE, t.id`
        )
        .all() as TesterRow[]
    ).filter((r) => isGameId(r.game))
    return json({ testers })
  }
  if (req.method !== 'POST' || (path !== '/admin/testers' && path !== '/admin/testers/remove'))
    return notFound
  if (!adminWriteAllowed(req, deps)) return notFound
  const type = req.headers.get('content-type')
  if (type === null || type.split(';')[0].trim().toLowerCase() !== 'application/json')
    return json({ error: 'unsupported-media-type' }, 415)
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (body === null || typeof body !== 'object') return json({ error: 'Bad request' }, 400)

  if (path === '/admin/testers/remove') {
    if (typeof body.id !== 'number' || !Number.isInteger(body.id))
      return json({ error: 'Bad request' }, 400)
    db.prepare('DELETE FROM game_testers WHERE id = ?').run(body.id)
    return json({ ok: true })
  }

  const game = body.game
  if (!isGameId(game)) return json({ error: 'Bad request' }, 400)
  if (GAMES[game].access !== 'testers') return json({ error: 'not-a-tester-game' }, 400)
  const { username, discordUsername } = body
  const byApp = typeof username === 'string' && username.trim() !== ''
  const byDiscord = typeof discordUsername === 'string' && discordUsername.trim() !== ''
  if (byApp === byDiscord) return json({ error: 'Bad request' }, 400)

  const row = db.transaction((): TesterRow | null => {
    if (byApp) {
      const user = db
        .prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE AND closed_at IS NULL')
        .get((username as string).trim()) as { id: number } | undefined
      if (!user) return null
      db.prepare('INSERT OR IGNORE INTO game_testers (game, user_id) VALUES (?, ?)').run(
        game,
        user.id
      )
      // The account's own row is the one that wins; a pending invite for the same game is moot.
      return db
        .prepare(`${SELECT_ROWS} WHERE t.game = ? AND t.user_id = ?`)
        .get(game, user.id) as TesterRow
    }
    const name = (discordUsername as string).trim()
    db.prepare(
      `INSERT OR IGNORE INTO game_testers (game, discord_username) SELECT ?, ?
        WHERE NOT EXISTS (SELECT 1 FROM game_testers WHERE game = ? AND user_id IS NULL
                            AND discord_username = ? COLLATE NOCASE)`
    ).run(game, name, game, name)
    return db
      .prepare(
        `${SELECT_ROWS} WHERE t.game = ? AND t.user_id IS NULL AND t.discord_username = ? COLLATE NOCASE`
      )
      .get(game, name) as TesterRow
  })()
  if (row === null) return json({ error: 'no-such-user' }, 404)
  return json(row)
}
