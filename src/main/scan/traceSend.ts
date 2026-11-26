import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { isGameId } from '../../shared/games'
import type { GameId } from '../../shared/games/types'
import {
  MAX_TRACE_NOTE,
  type TraceSendState,
  type TraceStart,
  type TraceStarted
} from '../../shared/traces'

/** What the sender needs of the portal, as the signed-in account. */
export interface TraceClient {
  traceStart(start: TraceStart): Promise<TraceStarted>
  traceFile(id: number, name: string, token: string, bytes: ArrayBuffer): Promise<void>
  traceDone(id: number): Promise<unknown>
}

/** Frames sent at once. */
const IN_FLIGHT = 3
/** Tries at one file before the send gives up. */
const TRIES = 3

export interface TraceSender {
  /** Starts sending the newest session; a send already going is left to finish. */
  send(note: string): TraceSendState
  state(): TraceSendState
}

/**
 * Sends a trace tester's newest scan trace session to the portal: starts it, puts each frame (a
 * few at a time) and then the log, as it is by then, and says it is done. Runs in the background,
 * so the scan carries on meanwhile; `state` tells how far it got. A frame the writer dropped while
 * it went (the oldest make room for new ones) is skipped.
 */
export function createTraceSender(deps: {
  root: string
  latest(): Promise<string | null>
  appVersion: string
  /** Runs a call as the signed-in account; rejects as account.traces does. */
  asAccount<T>(call: (client: TraceClient) => Promise<T>): Promise<T>
  /** Messages the account wrapper rejects with when signed out. */
  isSignedOut(e: unknown): boolean
}): TraceSender {
  let current: TraceSendState = { kind: 'idle' }

  const reasonOf = (e: unknown): Extract<TraceSendState, { kind: 'failed' }>['reason'] => {
    if (deps.isSignedOut(e)) return 'signed-out'
    const message = e instanceof Error ? e.message : ''
    if (message === 'daily-cap') return 'daily-cap'
    if (e instanceof Error && e.name === 'CloudNotFoundError') return 'not-allowed'
    return 'offline'
  }

  async function withTries(put: () => Promise<void>): Promise<void> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await put()
      } catch (e) {
        if (attempt >= TRIES) throw e
        await new Promise((r) => setTimeout(r, 1000 * attempt))
      }
    }
  }

  async function run(note: string): Promise<TraceSendState> {
    const session = await deps.latest()
    if (!session) return { kind: 'failed', reason: 'no-trace' }
    const dir = join(deps.root, session)
    const names = await readdir(dir).catch(() => [] as string[])
    if (!names.includes('trace.jsonl')) return { kind: 'failed', reason: 'no-trace' }
    const frames = names
      .filter((n) => /^\d+\.jpg$/.test(n))
      .sort((a, b) => parseInt(a) - parseInt(b))
    const game = await gameOf(join(dir, 'trace.jsonl'))
    const total = frames.length + 1
    current = { kind: 'sending', sent: 0, total }
    try {
      const { id, token } = await deps.asAccount((c) =>
        c.traceStart({
          game,
          session,
          note: note.slice(0, MAX_TRACE_NOTE),
          appVersion: deps.appVersion
        })
      )
      let sent = 0
      let next = 0
      const worker = async (): Promise<void> => {
        while (next < frames.length) {
          const name = frames[next++]!
          const bytes = await readFile(join(dir, name)).catch(() => null)
          if (bytes)
            await withTries(() =>
              deps.asAccount((c) => c.traceFile(id, name, token, toArrayBuffer(bytes)))
            )
          current = { kind: 'sending', sent: ++sent, total }
        }
      }
      await Promise.all(Array.from({ length: IN_FLIGHT }, worker))
      // The log last, so it holds every frame sent.
      const log = await readFile(join(dir, 'trace.jsonl'))
      await withTries(() =>
        deps.asAccount((c) => c.traceFile(id, 'trace.jsonl', token, toArrayBuffer(log)))
      )
      await deps.asAccount((c) => c.traceDone(id))
      return { kind: 'sent', id, files: sent + 1 }
    } catch (e) {
      return { kind: 'failed', reason: reasonOf(e) }
    }
  }

  return {
    send(note) {
      if (current.kind === 'sending') return current
      current = { kind: 'sending', sent: 0, total: 0 }
      void run(note).then(
        (s) => (current = s),
        () => (current = { kind: 'failed', reason: 'offline' })
      )
      return current
    },
    state: () => current
  }
}

const toArrayBuffer = (b: Buffer): ArrayBuffer =>
  b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer

/** The game the session scanned, from its first line; Yu-Gi-Oh! when it can't be read. */
async function gameOf(log: string): Promise<GameId> {
  try {
    const text = await readFile(log, 'utf8')
    const first = JSON.parse(text.split('\n', 1)[0]!) as { game?: unknown }
    return isGameId(first.game) ? first.game : 'ygo'
  } catch {
    return 'ygo'
  }
}
