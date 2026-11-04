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

export interface TrainingSummary { total: number; today: number; dailyCap: number }

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
    game, cardId, printingId, holder: holder as TrainingHolder, device, appVersion,
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
