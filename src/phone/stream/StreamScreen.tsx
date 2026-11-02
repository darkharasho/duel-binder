import { useCallback, useEffect, useRef, useState } from 'react'
import type { EngineFactory } from '@/features/scan/engine'
import { useBackHandler } from '../backButton'
import { useScanHub } from '@/features/scan/ScanHub'
import { flagText } from '@/features/scan/ScanRowItem'
import { plural } from '@/features/scan/scanText'
import type { ScanRow } from '@/features/scan/session'
import { sessionSummary } from '@/features/scan/window/summary'
import { PAGE_ROWS, SummaryScreen } from '@/features/scan/window/SummaryScreen'
import { useGame } from '@/lib/game'
import { cn } from '@/lib/utils'
import { ReviewSheet } from '../ReviewSheet'
import { enterStream, exitStream, reacquireStream } from './device'
import {
  endStream,
  loadStream,
  newStream,
  recordPull,
  recordSaved,
  reconcile,
  saveStream,
  streamCards,
  type StreamRecord
} from './record'
import { StreamCamera } from './StreamCamera'
import { StreamStart } from './StreamStart'

/** How long Close stream and Pause show after a tap. */
const CONTROLS_MS = 3000

/** Clear of the clock and the Dynamic Island upright, and of the notch sideways. */
const SAFE_TOP =
  'pt-[calc(env(safe-area-inset-top)+0.5rem)] pl-[calc(env(safe-area-inset-left)+0.75rem)] pr-[calc(env(safe-area-inset-right)+0.75rem)]'

const PILL =
  'rounded-full bg-black/45 px-3 py-1 text-sm font-semibold text-white tabular-nums backdrop-blur-md'
const CONTROL =
  'h-11 rounded-full border border-white/[0.13] bg-black/55 px-5 text-[15px] font-semibold text-white backdrop-blur-xl active:bg-black/70'

/** The summary's padding: clear of the Dynamic Island upright and of the notch sideways. */
const SUMMARY_SAFE =
  'pt-[calc(env(safe-area-inset-top)+4vh)] pl-[max(4vw,env(safe-area-inset-left))] pr-[max(4vw,env(safe-area-inset-right))]'

/** Rows to a summary page that fit under the hit upright (5.6vh each) or beside it sideways. */
const PORTRAIT_HIT_ROWS = 6
const LANDSCAPE_ROWS = 7

const PORTRAIT = '(orientation: portrait)'
const readPortrait = (): boolean => window.matchMedia?.(PORTRAIT).matches ?? true

/** Whether the phone is upright, following a turn. */
function usePortrait(): boolean {
  const [portrait, setPortrait] = useState(readPortrait)
  useEffect(() => {
    const query = window.matchMedia?.(PORTRAIT)
    if (!query) return
    const change = (): void => setPortrait(query.matches)
    query.addEventListener('change', change)
    return () => query.removeEventListener('change', change)
  }, [])
  return portrait
}

type Phase = 'start' | 'live' | 'over'

/**
 * Stream mode: the start screen, then the camera full screen for viewers of a screen share, with
 * each pull popping up as on the desktop's stream window. The stream keeps its own record of its
 * pulls (record.ts) for its count, saved on every change so a crash can carry on; saving happens
 * only in the review drawer. Between pulls viewers see the picture, the corner marks and the
 * count; a tap shows Close stream and Pause for a moment. Any way out puts the phone back upright
 * and lets it sleep.
 */
export function StreamScreen({
  engineFactory,
  onExit
}: {
  engineFactory?: EngineFactory
  onExit: () => void
}): React.JSX.Element {
  const { session, settings, onSaved } = useScanHub()
  const { game } = useGame()
  const rows = session.rows
  const [phase, setPhase] = useState<Phase>('start')
  // A stream left running (the app closed or crashed), offered to carry on.
  const [left, setLeft] = useState(() => {
    const r = loadStream()
    return r?.game === game ? r : null
  })
  const [record, setRecord] = useState<StreamRecord | null>(null)
  const [awake, setAwake] = useState<boolean | null>(null)
  const [paused, setPaused] = useState(false)
  const [controls, setControls] = useState(true)
  const [taps, setTaps] = useState(0)
  const [reviewing, setReviewing] = useState(false)
  const portrait = usePortrait()

  // A second tap on Start while the first is still taking the device.
  const starting = useRef(false)

  const showControls = (): void => {
    setControls(true)
    setTaps((n) => n + 1)
  }
  useEffect(() => {
    if (!controls) return
    const timer = setTimeout(() => setControls(false), CONTROLS_MS)
    return () => clearTimeout(timer)
  }, [controls, taps])

  /**
   * Goes live on `next`, once the phone is held awake or the start screen has said it can't be.
   * `fresh`: a new stream, so a record left running ends, only once the new one is live.
   */
  const begin = async (next: StreamRecord, fresh = false): Promise<void> => {
    if (starting.current) return
    if (awake === null) {
      starting.current = true
      const held = await enterStream().finally(() => (starting.current = false))
      setAwake(held.awake)
      if (!held.awake) return
    }
    if (fresh) {
      endStream()
      setLeft(null)
    }
    setRecord(next)
    setPhase('live')
    showControls()
  }

  useEffect(() => {
    if (record) saveStream(record)
  }, [record])
  // Copies saved from the drawer stay in the count after they leave the list.
  useEffect(
    () => onSaved((key, quantity) => setRecord((r) => r && recordSaved(r, key, quantity))),
    [onSaved]
  )
  // Edits on the list (a printing, a quantity, a removal) reach the record.
  const current = record && record.game === game ? reconcile(record, rows) : record
  if (current !== record) setRecord(current)
  const pulled = useCallback((row: ScanRow) => setRecord((r) => r && recordPull(r, row)), [])

  const started = phase !== 'start'
  // Android's back leaves the start screen, but never ends a running stream: it just shows the controls.
  useBackHandler(true, () => (started ? showControls() : onExit()))
  useEffect(() => {
    if (!started) return
    // The browser drops the wake lock whenever the page is hidden (a trip to Discord, a call).
    const shown = (): void => {
      if (document.visibilityState === 'visible') void reacquireStream()
    }
    document.addEventListener('visibilitychange', shown)
    return () => document.removeEventListener('visibilitychange', shown)
  }, [started])
  useEffect(() => () => void exitStream(), [])

  if (!started || record === null) {
    const carry = left && reconcile(left, rows)
    return (
      <StreamStart
        carryOn={carry && streamCards(carry) > 0 ? streamCards(carry) : null}
        awake={awake}
        // Start new: the old record goes, the list stays as it is.
        onStart={() => void begin(newStream(game), true)}
        onCarryOn={() => {
          if (carry) void begin(carry)
        }}
        onClose={onExit}
      />
    )
  }

  const cards = streamCards(record)
  const summary = sessionSummary(record.rows, settings.hitPrice)
  const toCheck = rows.filter((r) => flagText(r) !== null).length
  return (
    <section
      aria-label="Stream"
      className="relative isolate h-full w-full overflow-hidden bg-black"
      onClick={showControls}
    >
      <StreamCamera
        engineFactory={engineFactory}
        paused={paused || phase === 'over'}
        onPull={pulled}
      >
        <div data-safe-top className={cn('absolute inset-x-0 top-0 flex flex-col gap-3', SAFE_TOP)}>
          {!paused && (
            <div className="flex items-start justify-between gap-3">
              <p className={PILL}>{plural(cards, 'card', 'cards')}</p>
              {toCheck > 0 && (
                <button
                  type="button"
                  className={cn(PILL, 'text-amber-300')}
                  onClick={() => setReviewing(true)}
                >
                  {toCheck} to check
                </button>
              )}
            </div>
          )}
          {phase === 'live' && (
            <div
              aria-hidden={!controls}
              inert={!controls}
              className={cn(
                'flex justify-center gap-3 transition-opacity duration-300',
                !controls && 'pointer-events-none opacity-0'
              )}
            >
              <button type="button" className={CONTROL} onClick={() => setPhase('over')}>
                Close stream
              </button>
              <button type="button" className={CONTROL} onClick={() => setPaused((p) => !p)}>
                {paused ? 'Resume' : 'Pause'}
              </button>
            </div>
          )}
        </div>
        {phase === 'live' && !reviewing && !paused && (
          <button
            type="button"
            aria-label="Review"
            onClick={() => setReviewing(true)}
            className="absolute bottom-[calc(env(safe-area-inset-bottom)+0.25rem)] left-1/2 flex h-7 w-20 -translate-x-1/2 items-center justify-center"
          >
            <span aria-hidden className="h-1.5 w-10 rounded-full bg-white/45" />
          </button>
        )}
      </StreamCamera>
      {phase === 'over' && (
        // The end of a stream, plainly: leaving ends its record and keeps the list as it is.
        <div className="absolute inset-0 flex flex-col">
          {/* The summary fills what the buttons leave, so no row sits under them. */}
          <div className="relative min-h-0 flex-1">
            <SummaryScreen
              summary={summary}
              className={SUMMARY_SAFE}
              pageRows={portrait ? (summary.hit ? PORTRAIT_HIT_ROWS : PAGE_ROWS) : LANDSCAPE_ROWS}
            />
          </div>
          <div className="flex shrink-0 justify-center gap-3 bg-neutral-950/65 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur-[2vw]">
            <button type="button" className={CONTROL} onClick={() => setReviewing(true)}>
              Review
            </button>
            <button
              type="button"
              className={CONTROL}
              onClick={() => {
                endStream()
                onExit()
              }}
            >
              Done
            </button>
          </div>
        </div>
      )}
      {reviewing && (
        // React events bubble through portals, so the drawer's own taps stop here and never wake the controls.
        <div className="contents" onClick={(e) => e.stopPropagation()}>
          <ReviewSheet stream onClose={() => setReviewing(false)} />
        </div>
      )}
    </section>
  )
}
