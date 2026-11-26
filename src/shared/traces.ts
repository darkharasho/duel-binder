/**
 * Donated scan traces: a trace tester's scan trace (the per-frame log and the frames kept with it)
 * sent to the portal for the owner to look into. Shared by the portal (workers/portal/src/traces.ts),
 * the desktop's sender (src/main/scan/traceSend.ts) and the admin tab.
 */
import type { GameId } from './games/types'

const MB = 1024 * 1024

/** Traces one account may start sending in a day. */
export const TRACE_DAILY_CAP = 3
/** A trace's log, at most. */
export const MAX_TRACE_LOG_BYTES = 32 * MB
/** One kept frame, at most (main keeps none over 4 MB). */
export const MAX_TRACE_FRAME_BYTES = 8 * MB
/** Files one trace may hold: its log and its frames. */
export const MAX_TRACE_FILES = 1001
/** A trace's note, at most. */
export const MAX_TRACE_NOTE = 1000
/** How long a trace's upload token lasts. */
export const TRACE_UPLOAD_MS = 6 * 60 * 60 * 1000

/** A trace session: its ISO start time with `:` and `.` made `-` (main's TRACE_SESSION). */
export const TRACE_SESSION_RE = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/
/** The files a trace holds: `trace.jsonl` and its frames, `NNNN.jpg` and up. */
export const TRACE_FILE_RE = /^(trace\.jsonl|\d{4,6}\.jpg)$/

/** The R2 key of a donated trace's file. */
export const traceFileKey = (id: number, name: string): string => `traces/${id}/${name}`
/** The R2 prefix of every file of a donated trace. */
export const tracePrefix = (id: number): string => `traces/${id}/`

/** POST /api/traces: a trace about to be sent. */
export interface TraceStart {
  game: GameId
  session: string
  /** What went wrong, in the tester's words; may be empty. */
  note: string
  appVersion: string
}

/** POST /api/traces answers: where its files go, and the token that lets them in. */
export interface TraceStarted {
  id: number
  token: string
}

/** One donated trace, as the tester's own list and the admin tab show it. */
export interface TraceRow {
  id: number
  game: GameId
  session: string
  note: string
  appVersion: string
  files: number
  bytes: number
  createdAt: string
  /** When every file was in; null while sending (or cut off before it finished). */
  doneAt: string | null
}

/** A donated trace in the admin tab: whose it is too. */
export interface AdminTrace extends TraceRow {
  userId: number | null
  username: string | null
}

/** One of a donated trace's files. */
export interface TraceFile {
  name: string
  size: number
}

/** GET /admin/trace-testers: the accounts that trace and may send traces. */
export interface AdminTraceTester {
  userId: number
  username: string
  displayName: string | null
  addedAt: string
}

/** How a send is going, as main tells the Scan page. */
export type TraceSendState =
  | { kind: 'idle' }
  | { kind: 'sending'; sent: number; total: number }
  | { kind: 'sent'; id: number; files: number }
  | { kind: 'failed'; reason: 'no-trace' | 'daily-cap' | 'signed-out' | 'not-allowed' | 'offline' }
