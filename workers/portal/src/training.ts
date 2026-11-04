import { GAMES, GAME_IDS, isGameId, type GameId } from '../../../src/shared/games'
import {
  CLIENT_ID_RE,
  MAX_TRAINING_PHOTO_BYTES,
  TRAINING_DAILY_CAP,
  readLabel,
  trainingKey,
  type TrainingSummary
} from '../../../src/shared/training'
import type { AppDeps } from './app'
import { currentUser, fromPublicOrigin, gamesFor } from './auth'

/** The slice of the R2 binding the training routes use. */
export interface TrainingBucket {
  put(
    key: string,
    value: ArrayBuffer,
    opts: { httpMetadata: { contentType: string } }
  ): Promise<unknown>
  get(key: string): Promise<{ body: ReadableStream } | null>
  delete(key: string): Promise<void>
}

const DAY_MS = 24 * 60 * 60 * 1000

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
  })
const notFound = (): Response => json({ error: 'not-found' }, 404)

/** Whether this account may send training photos of `game`: a 'testers' game it sees (the owner sees every one). */
export function mayContribute(deps: AppDeps, userId: number, game: string): game is GameId {
  return (
    isGameId(game) &&
    GAMES[game].access === 'testers' &&
    gamesFor(deps, userId, game).includes(game)
  )
}

const since = (deps: AppDeps): string => new Date(deps.now().getTime() - DAY_MS).toISOString()

/** Photos this account sent in the last 24 hours, every game. */
function sentToday(deps: AppDeps, userId: number): number {
  return (
    deps.db
      .prepare('SELECT COUNT(*) AS n FROM training_photos WHERE user_id = ? AND created_at > ?')
      .get(userId, since(deps)) as { n: number }
  ).n
}

function summary(deps: AppDeps, userId: number, game: GameId): TrainingSummary {
  const total = (
    deps.db
      .prepare('SELECT COUNT(*) AS n FROM training_photos WHERE user_id = ? AND game = ?')
      .get(userId, game) as { n: number }
  ).n
  return { total, today: sentToday(deps, userId), dailyCap: TRAINING_DAILY_CAP }
}

/** The body, read a chunk at a time and given up past the cap, so the one Durable Object never buffers a huge upload. */
async function readCapped(req: Request): Promise<Uint8Array | 'too-big'> {
  if (!req.body) return new Uint8Array(0)
  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_TRAINING_PHOTO_BYTES) {
      await reader.cancel().catch(() => undefined)
      return 'too-big'
    }
    chunks.push(value)
  }
  const out = new Uint8Array(size)
  let at = 0
  for (const c of chunks) {
    out.set(c, at)
    at += c.byteLength
  }
  return out
}

const isJpeg = (b: Uint8Array): boolean => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff

async function upload(
  req: Request,
  deps: AppDeps,
  userId: number,
  clientId: string
): Promise<Response> {
  const url = new URL(req.url)
  if (!mayContribute(deps, userId, url.searchParams.get('game') ?? '')) return notFound()
  if (!CLIENT_ID_RE.test(clientId)) return json({ error: 'bad-id' }, 400)
  const label = readLabel(url.searchParams, deps.now())
  if (!label) return json({ error: 'bad-label' }, 400)
  const printing = deps.db
    .prepare(
      'SELECT p.card_id, c.game FROM card_printings p JOIN cards c ON c.id = p.card_id WHERE p.id = ?'
    )
    .get(label.printingId) as { card_id: number; game: string } | undefined
  if (!printing || printing.card_id !== label.cardId || printing.game !== label.game)
    return json({ error: 'bad-printing' }, 400)
  const exists = deps.db
    .prepare('SELECT 1 FROM training_photos WHERE user_id = ? AND client_id = ?')
    .get(userId, clientId)
  if (exists) return json(summary(deps, userId, label.game))

  const type = (req.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
  if (type !== 'image/jpeg') return json({ error: 'not-jpeg' }, 415)
  if (Number(req.headers.get('content-length') ?? 0) > MAX_TRAINING_PHOTO_BYTES)
    return json({ error: 'too-big' }, 413)
  const body = await readCapped(req)
  if (body === 'too-big') return json({ error: 'too-big' }, 413)
  if (!isJpeg(body)) return json({ error: 'not-jpeg' }, 415)

  if (sentToday(deps, userId) >= TRAINING_DAILY_CAP) return json({ error: 'daily-cap' }, 429)
  const training = deps.training
  if (!training) return json({ error: 'unavailable' }, 503)
  const key = trainingKey(label.game, userId, clientId)
  await training.put(key, body.buffer as ArrayBuffer, {
    httpMetadata: { contentType: 'image/jpeg' }
  })
  // Uploads in flight meanwhile may have reached the cap.
  if (sentToday(deps, userId) >= TRAINING_DAILY_CAP) {
    await training.delete(key).catch(() => undefined)
    return json({ error: 'daily-cap' }, 429)
  }
  deps.db
    .prepare(
      `INSERT OR IGNORE INTO training_photos (user_id, client_id, game, card_id, printing_id,
         holder, device, app_version, taken_at, created_at, bytes, r2_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      userId,
      clientId,
      label.game,
      label.cardId,
      label.printingId,
      label.holder,
      label.device,
      label.appVersion,
      label.takenAt,
      deps.now().toISOString(),
      body.byteLength,
      key
    )
  return json(summary(deps, userId, label.game))
}

async function remove(deps: AppDeps, userId: number, clientId: string): Promise<Response> {
  if (!GAME_IDS.some((g) => mayContribute(deps, userId, g))) return notFound()
  const row = deps.db
    .prepare('SELECT id, r2_key FROM training_photos WHERE user_id = ? AND client_id = ?')
    .get(userId, clientId) as { id: number; r2_key: string } | undefined
  if (row) {
    if (!deps.training) return json({ error: 'unavailable' }, 503)
    await deps.training.delete(row.r2_key)
    deps.db.prepare('DELETE FROM training_photos WHERE id = ?').run(row.id)
  }
  return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } })
}

/**
 * /api/training/*, testers sending labelled card photos for scanner training:
 *   POST   photos/<clientId>?<labelParams>  an image/jpeg body; idempotent per client id
 *   DELETE photos/<clientId>                 the caller's own photo, if any
 *   GET    summary?game=<g>                  the caller's counts
 * Anyone who can't contribute gets the same 404 as an unknown path, before any 400. The photos are
 * never served from here: only the token-only admin route reads them back.
 */
export async function trainingRoute(req: Request, deps: AppDeps, rest: string): Promise<Response> {
  const user = await currentUser(req, deps)
  if (!user) return json({ error: 'signed-out' }, 401)
  const photo = /^photos\/([^/]+)$/.exec(rest)
  if (photo && (req.method === 'POST' || req.method === 'DELETE')) {
    // A write with the web session cookie must come from the app's own origin.
    if (user.kind === 'web' && !fromPublicOrigin(req, deps))
      return json({ error: 'bad-origin' }, 403)
    return req.method === 'POST'
      ? upload(req, deps, user.id, photo[1])
      : remove(deps, user.id, photo[1])
  }
  if (rest === 'summary' && req.method === 'GET') {
    const game = new URL(req.url).searchParams.get('game') ?? ''
    if (!mayContribute(deps, user.id, game)) return notFound()
    return json(summary(deps, user.id, game))
  }
  return notFound()
}
