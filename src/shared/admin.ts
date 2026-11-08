/**
 * What the portal's /admin/* JSON answers, as the desktop's in-app admin pages read them
 * (workers/portal/src: stats.ts, errors.ts, merge.ts, testers.ts, admins.ts, training.ts).
 */
import type { GameId } from './games/types'
import type { TrainingStats } from './training'

/** GET /admin/stats (collectStats). One read counts every table, so it's read only when asked. */
export interface AdminStats {
  at: string
  users: {
    total: number
    discord: number
    apple: number
    email: number
    new7d: number
    new30d: number
  }
  active: { day: number; week: number; month: number }
  sessions: Record<string, number>
  collections: {
    collectors: number
    entries: number
    cards: number
    largest: { username: string; entries: number; cards: number }[]
  }
  friends: { accepted: number; pending: number; blocks: number }
  scan: { contributions: number; contributions7d: number }
  priceRequests: { today: number; last7d: number }
  sweep: { callsToday: number; sweptLast7d: number; prefixes: number }
  usage: {
    since: string
    totals: { event: string; platform: string; count: number }[]
    opensByDay: { day: string; count: number }[]
  }
  storage: { databaseBytes: number | null; rows: Record<string, number> }
}

/** One message's latest reports, from GET /admin/errors. */
export interface AdminErrorGroup {
  message: string
  count: number
  reports: { day: string; platform: string; appVersion: string; stack: string | null }[]
}

/** A merge still inside its 30 days, from GET /admin/merges. */
export interface AdminMerge {
  closedId: number
  survivorId: number
  survivorUsername: string | null
  closedUsername: string
  mergedAt: string
  purgeAfter: string
  cards: number
}

/** A sign-in an undone merge couldn't give back. */
export interface AdminSkippedSignIn {
  provider: string
  subject: string
}

/** One account (or pending Discord invite) on a tester-only game, from GET /admin/testers. */
export interface AdminTester {
  id: number
  game: GameId
  discordUsername: string | null
  userId: number | null
  username: string | null
}

/** How a tester is added: by app username, or by a Discord username not yet signed in. */
export type AdminTesterBy = 'username' | 'discordUsername'

/** GET /admin/admins. */
export interface AdminList {
  admins: {
    userId: number
    username: string
    displayName: string | null
    addedAt: string
    /** How the account signs in, e.g. "discord,email". */
    signIns: string
  }[]
  /** The signed-in account's id. */
  you: number
}

export type AdminPhotos = TrainingStats

/** The GitHub workflows the Runs tab watches. */
export const ADMIN_WORKFLOWS = ['catalog.yml', 'release.yml'] as const
export type AdminWorkflow = (typeof ADMIN_WORKFLOWS)[number]

/** The fields of a GitHub Actions run the Runs tab reads. */
export interface GhRun {
  id: number
  html_url: string
  status: string
  conclusion: string | null
  event: string
  run_started_at: string
  updated_at: string
}

export interface GhStep {
  name: string
  status: string
  conclusion: string | null
  started_at: string | null
  completed_at: string | null
}

export interface GhJob {
  steps?: GhStep[]
}
