import { isGameId, type GameId } from './games'

export const TRAINING_HOLDERS = ['bare', 'sleeve', 'toploader', 'case', 'slab'] as const
export type TrainingHolder = (typeof TRAINING_HOLDERS)[number]

export const HOLDER_LABELS: Record<TrainingHolder, string> = {
  bare: 'Bare',
  sleeve: 'Sleeve',
  toploader: 'Top loader',
  case: 'Magnetic case',
  slab: 'Slab'
}

export const MAX_TRAINING_PHOTO_BYTES = 8 * 1024 * 1024
export const TRAINING_DAILY_CAP = 500
export const CLIENT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

export interface TrainingLabel {
  game: GameId
  cardId: number
  printingId: number
  holder: TrainingHolder
  device: string
  appVersion: string
  takenAt: string
}

export interface TrainingSummary {
  total: number
  today: number
  dailyCap: number
}

/** How a training photo call went; `retry` says whether to keep the outbox item for later. */
export type TrainingSend =
  | { ok: true; summary: TrainingSummary | null }
  | {
      ok: false
      retry: boolean
      reason: 'offline' | 'signed-out' | 'daily-cap' | 'too-big' | 'rejected'
    }

/** How a /api/training/ answer reads as a TrainingSend (401 is the caller's: it signs out). */
export async function trainingAnswer(res: Response): Promise<TrainingSend> {
  if (res.status === 401) return { ok: false, retry: true, reason: 'signed-out' }
  if (res.status >= 500) return { ok: false, retry: true, reason: 'offline' }
  if (res.status === 429) return { ok: false, retry: true, reason: 'daily-cap' }
  if (res.status === 413) return { ok: false, retry: false, reason: 'too-big' }
  if (res.status !== 200 && res.status !== 204)
    return { ok: false, retry: false, reason: 'rejected' }
  if (res.status === 204) return { ok: true, summary: null }
  const body = (await res.json().catch(() => null)) as Partial<TrainingSummary> | null
  return {
    ok: true,
    summary:
      body && typeof body.total === 'number' && typeof body.today === 'number'
        ? { total: body.total, today: body.today, dailyCap: Number(body.dailyCap) }
        : null
  }
}

export function labelParams(l: TrainingLabel): URLSearchParams {
  return new URLSearchParams({
    game: l.game,
    card: String(l.cardId),
    printing: String(l.printingId),
    holder: l.holder,
    device: l.device,
    app: l.appVersion,
    at: l.takenAt
  })
}

const APP_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]{1,20})?$/
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/
const DAY_MS = 24 * 60 * 60 * 1000

const positiveInt = (s: string | null): number | null => {
  if (s === null || !/^\d+$/.test(s)) return null
  const n = Number(s)
  return Number.isSafeInteger(n) && n > 0 ? n : null
}

export function readLabel(q: URLSearchParams, now: Date): TrainingLabel | null {
  const game = q.get('game')
  if (game === null || !isGameId(game)) return null
  const cardId = positiveInt(q.get('card'))
  const printingId = positiveInt(q.get('printing'))
  if (cardId === null || printingId === null) return null
  const holder = q.get('holder')
  if (!holder || !(TRAINING_HOLDERS as readonly string[]).includes(holder)) return null
  const device = (q.get('device') ?? '').trim()
  if (device.length < 1 || device.length > 100 || CONTROL_RE.test(device)) return null
  const appVersion = q.get('app') ?? ''
  if (!APP_RE.test(appVersion)) return null
  const at = new Date(q.get('at') ?? '')
  const t = at.getTime()
  if (Number.isNaN(t) || t < now.getTime() - 30 * DAY_MS || t > now.getTime() + DAY_MS) return null
  return {
    game,
    cardId,
    printingId,
    holder: holder as TrainingHolder,
    device,
    appVersion,
    takenAt: at.toISOString()
  }
}

export const trainingKey = (game: GameId, userId: number, clientId: string): string =>
  `training/${game}/${userId}/${clientId}.jpg`

export interface TrainingLabelRow {
  id: number
  clientId: string
  game: GameId
  userId: number
  username: string
  cardId: number
  printingId: number
  holder: TrainingHolder
  device: string
  appVersion: string
  takenAt: string
  createdAt: string
  language: string | null
  number: string | null
  bandaiId: string | null
  version: string | null
}

/** /admin/training: what the testers have sent so far. */
export interface TrainingStats {
  games: { game: GameId; photos: number; testers: number; cards: number; versions: number }[]
  testers: {
    game: GameId
    userId: number
    username: string
    photos: number
    today: number
    lastAt: string
  }[]
  holders: { game: GameId; holder: TrainingHolder; photos: number; versions: number }[]
}

export interface TruthRow {
  file: string
  source: 'app'
  sourceId: string | null
  version: string | null
  language: string | null
  holder: TrainingHolder
  bandaiId: string | null
  tester: string
  device: string
  appVersion: string
  takenAt: string
}

export function truthRowOf(r: TrainingLabelRow): TruthRow {
  return {
    file: `shots-${r.game}/${r.clientId}.jpg`,
    source: 'app',
    sourceId: r.language !== null && r.number !== null ? `${r.language}/${r.number}` : null,
    version: r.version,
    language: r.language,
    holder: r.holder,
    bandaiId: r.bandaiId ? r.bandaiId : null,
    tester: r.username,
    device: r.device,
    appVersion: r.appVersion,
    takenAt: r.takenAt
  }
}
