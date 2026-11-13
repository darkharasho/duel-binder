/**
 * The admin scan trace, renderer side: the switch, a recorder around the resolver's lookups, the
 * per-frame line and which frames are written (with or without their JPEG). Main writes it to
 * userData/scan-trace (src/main/scan/scanTrace.ts); nothing leaves the machine.
 */
import type { GameId } from '@shared/games/types'
import type { FrameSignals } from './engine'
import type { ScanOutcome } from './resolve'

const KEY = 'scan.trace'
/** Main refuses a longer line. */
export const MAX_TRACE_LINE = 8192

export function scanTraceOn(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

export function setScanTraceOn(on: boolean): void {
  try {
    if (on) localStorage.setItem(KEY, '1')
    else localStorage.removeItem(KEY)
  } catch {
    // Unavailable storage only costs the remembered choice.
  }
}

/** A trace session's folder name: its start time, ISO with `:` and `.` made `-`. */
export function newTraceSession(now = new Date()): string {
  return now.toISOString().replace(/[:.]/g, '-')
}

export type TraceCall = { m: string; args: unknown; out?: unknown; error?: string; ms: number }

/**
 * `lookups` with every function recording its call: arguments, result or error, and time. Results
 * and errors reach the caller unchanged.
 */
export function recordLookups<L extends object>(lookups: L): { lookups: L; calls: TraceCall[] } {
  const calls: TraceCall[] = []
  const wrapped = {} as Record<string, unknown>
  for (const [m, fn] of Object.entries(lookups)) {
    if (typeof fn !== 'function') {
      wrapped[m] = fn
      continue
    }
    wrapped[m] = async (...args: unknown[]) => {
      const start = performance.now()
      const call: TraceCall = { m, args, ms: 0 }
      calls.push(call)
      try {
        const out: unknown = await (fn as (...a: unknown[]) => unknown).apply(lookups, args)
        call.out = out
        return out
      } catch (e) {
        call.error = e instanceof Error ? e.message : String(e)
        throw e
      } finally {
        call.ms = Math.round(performance.now() - start)
      }
    }
  }
  return { lookups: wrapped as L, calls }
}

export interface TraceFrame {
  seq: number
  game: GameId
  setKey: string
  sets: string[]
  filterLanguage: string | null
  finishLock: string
  camera: string
  size: [number, number]
  raw: FrameSignals
  outcome: ScanOutcome
  counted: boolean
  calls: TraceCall[]
  reads: { language?: unknown; localName?: unknown }
  fpCount: number
  ms: Record<string, number>
}

type OutcomeName = 'none' | 'far' | 'unsure' | 'recognized'

export function outcomeName(o: ScanOutcome): OutcomeName {
  return o.kind === 'none' ? (o.far ? 'far' : 'none') : o.kind
}

/** One frame's trace line, JSON, at most MAX_TRACE_LINE long (long lookup results cut). */
export function traceLine(f: TraceFrame): string {
  const item = f.outcome.kind === 'recognized' ? f.outcome.item : null
  const line: Record<string, unknown> = {
    t: Date.now(),
    seq: f.seq,
    game: f.game,
    setKey: f.setKey,
    sets: f.sets,
    filterLanguage: f.filterLanguage,
    finishLock: f.finishLock,
    camera: f.camera,
    size: f.size,
    found: f.raw.found,
    quad: f.raw.quad,
    artVia: f.raw.artVia,
    artBack: f.raw.artBack,
    art: f.raw.art.slice(0, 5).map((a) => [a.imageId, a.distance]),
    fpCount: f.fpCount,
    calls: f.calls,
    reads: f.reads,
    outcome: outcomeName(f.outcome),
    ...(item && {
      card: {
        cardId: item.cardId,
        name: item.name,
        printingId: item.printingId,
        setCode: item.setCode,
        rarity: item.rarity,
        flag: item.flag,
        via: item.via,
        guess: item.guess ?? false
      }
    }),
    counted: f.counted,
    ms: f.ms
  }
  let json = JSON.stringify(line)
  if (json.length <= MAX_TRACE_LINE) return json
  line['calls'] = f.calls.map((c) =>
    Array.isArray(c.out) && c.out.length > 3
      ? { ...c, out: { count: c.out.length, first: c.out.slice(0, 3) } }
      : c
  )
  json = JSON.stringify(line)
  if (json.length <= MAX_TRACE_LINE) return json
  delete line['quad']
  line['calls'] = (line['calls'] as TraceCall[]).slice(-10)
  line['callsCut'] = true
  json = JSON.stringify(line)
  if (json.length <= MAX_TRACE_LINE) return json
  // Still too long (huge single results): keep only each call's name and time.
  line['calls'] = (line['calls'] as TraceCall[]).map(({ m, ms, error }) => ({ m, ms, error }))
  json = JSON.stringify(line)
  if (json.length <= MAX_TRACE_LINE) return json
  // Or the reads: drop them, then the calls, so the line is always whole JSON.
  line['reads'] = { cut: true }
  json = JSON.stringify(line)
  if (json.length <= MAX_TRACE_LINE) return json
  line['calls'] = []
  return JSON.stringify(line)
}

/**
 * Which frames are traced: every frame with a card found, and a stretch of frames with none only
 * once, with its JPEG (a card the scanner can't outline shows there). A found frame's JPEG is kept
 * on every 3rd one and on any whose outcome differs from the last traced frame's.
 */
export function createTraceSampler(): {
  take(found: boolean, outcome: string): { line: boolean; jpeg: boolean }
} {
  let last: string | null = null
  let lastFound = true
  let foundCount = 0
  return {
    take(found, outcome) {
      if (!found) {
        const line = lastFound
        lastFound = false
        if (line) last = outcome
        return { line, jpeg: line }
      }
      lastFound = true
      foundCount++
      const jpeg = outcome !== last || foundCount % 3 === 0
      last = outcome
      return { line: true, jpeg }
    }
  }
}
