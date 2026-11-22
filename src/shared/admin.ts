import type { SupporterPlan } from './supporter'
/**
 * What the portal's /admin/* JSON answers, as the desktop's in-app admin pages read them
 * (workers/portal/src: stats.ts, errors.ts, merge.ts, testers.ts, admins.ts, training.ts).
 */
import type { GameId } from './games/types'
import type { SearchTerm, TermEvidence, TermKind, TermTarget, TermTargetKind } from './search/terms'
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

/** One phone beta request from duelbinder.com/beta, as GET /admin/beta lists it. */
export interface AdminBetaRequest {
  id: number
  email: string
  platform: 'android' | 'ios'
  name: string
  referredBy: string
  status: 'pending' | 'added' | 'declined'
  createdAt: string
  decidedAt: string | null
}

/** GET /admin/beta: every request, waiting ones first, and how many Android testers are in. */
export interface AdminBeta {
  requests: AdminBetaRequest[]
  androidAdded: number
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

/** A search term as GET /admin/terms lists it: its eBay evidence and a card to show for its target. */
export type AdminTerm = SearchTerm & {
  evidence: TermEvidence
  preview: { cardName: string; imageId: number | null; label: string } | null
}

/** The fields an owner sets when approving with edits or adding a term. */
export interface AdminTermFields {
  phrase: string
  kind: TermKind
  targetKind: TermTargetKind
  target: TermTarget
}

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

/** A Rip capture key frame's details, kept beside it in the session's keyframes.jsonl. */
export interface RipFrameInfo {
  /** How sharp the frame was when picked (variance of a Laplacian on a small grey copy). */
  sharp: number
  width: number
  height: number
}

/** GET /admin/supporters: the supporter subscriptions (the Supporters tab). */
export interface AdminSupporters {
  /** Supporting now (active, trialing or retrying a payment). */
  active: number
  monthly: number
  yearly: number
  /** Gross monthly-equivalent income in cents: monthly amounts plus yearly amounts / 12. */
  monthlyCents: number
  /** Every account with a Stripe customer, newest supporter first. */
  list: {
    userId: number
    username: string
    displayName: string | null
    plan: SupporterPlan | null
    /** What each charge is, in cents; null before the first subscription. */
    amountCents: number | null
    status: string
    since: string | null
    until: string | null
    cancelling: boolean
    showOnSite: boolean
  }[]
}

/** One waitlist entry as GET /admin/seats lists it. */
export interface AdminWaitlistEntry {
  id: number
  email: string
  createdAt: string
  invitedAt: string | null
  inviteExpiresAt: string | null
  status: 'waiting' | 'invited' | 'expired' | 'joined'
}

/** GET /admin/seats: the seat counts and the waitlist. */
export interface AdminSeats {
  counts: { cap: number; accounts: number; invited: number; free: number; waiting: number }
  waitlist: AdminWaitlistEntry[]
}

/** One POST /admin/seats/{action}: `cap` carries the new cap; the entry actions carry the waitlist `id`; `fill` neither. */
export type AdminSeatsAction =
  | { action: 'cap'; cap: number }
  | { action: 'fill' }
  | { action: 'invite' | 'resend' | 'cancel' | 'delete'; id: number }
