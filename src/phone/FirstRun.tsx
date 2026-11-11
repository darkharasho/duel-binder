import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { CloudAuthError } from '../main/cloud/client'
import { FIRST_RUN_CELLULAR, FIRST_RUN_SIZE, FIRST_RUN_STOPPED, FIRST_RUN_TITLE } from './copy'
import type { CatalogProgress, PhoneStore } from './data/store'
import { PhoneScreen } from './PhoneScreen'
import { useMounted, useOnce } from './useOnce'

/** True on a cellular connection, where the browser says (Chrome on Android; not Safari). */
function onCellular(): boolean {
  const connection = (navigator as Navigator & { connection?: { type?: string } }).connection
  return connection?.type === 'cellular'
}

type Phase = 'ask' | 'downloading' | 'stopped'

/**
 * The first-run download: the card data (resumable, page by page) and the artwork fingerprints.
 * On Wi-Fi (or when the browser doesn't say) it starts at once; on mobile data it asks first.
 */
export function FirstRun({
  store,
  onDone,
  onSignedOut
}: {
  store: PhoneStore
  onDone: () => void
  onSignedOut: () => void
}): React.JSX.Element {
  const [cellular] = useState(onCellular)
  const [phase, setPhase] = useState<Phase>(cellular ? 'ask' : 'downloading')
  /** The first page's position (the feed's seqs are shared by every game), and the last one's. */
  const [progress, setProgress] = useState<{ base: number; at: CatalogProgress } | null>(null)

  const live = useMounted()

  const download = async (): Promise<void> => {
    setPhase('downloading')
    try {
      // The game shown only: the others, and the scan data, come down in the app's background.
      await store.fillCatalog((p) => {
        if (live.current) setProgress((old) => ({ base: old?.base ?? p.cursor, at: p }))
      })
      if (live.current) onDone()
    } catch (e) {
      if (!live.current) return
      if (e instanceof CloudAuthError) onSignedOut()
      else setPhase('stopped')
    }
  }

  useOnce(() => {
    if (!cellular) void download()
  })

  const span = progress ? progress.at.latest - progress.base : 0
  const percent =
    progress && span > 0
      ? Math.min(100, Math.round(((progress.at.cursor - progress.base) / span) * 100))
      : null

  return (
    <PhoneScreen>
      <div className="w-full space-y-1.5">
        <h1 className="text-lg font-semibold tracking-tight">{FIRST_RUN_TITLE}</h1>
        <p className="text-sm text-muted-foreground">
          {cellular ? FIRST_RUN_CELLULAR : FIRST_RUN_SIZE}
        </p>
      </div>
      {phase === 'ask' ? (
        <Button
          size="lg"
          className="h-[52px] w-full rounded-[14px] text-base"
          onClick={() => void download()}
        >
          Download
        </Button>
      ) : (
        <div className="w-full space-y-3">
          <div
            role="progressbar"
            aria-label={FIRST_RUN_TITLE}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent ?? undefined}
            className="h-1.5 overflow-hidden rounded-full bg-white/[0.08]"
          >
            <div
              className={
                percent === null
                  ? 'h-full w-1/3 animate-pulse rounded-full bg-gradient-to-r from-[#f0523a] to-amber-500'
                  : 'h-full rounded-full bg-gradient-to-r from-[#f0523a] to-amber-500 transition-[width] duration-300'
              }
              style={percent === null ? undefined : { width: `${percent}%` }}
            />
          </div>
          <p className="text-right text-sm text-muted-foreground tabular-nums">
            {percent === null ? 'Starting…' : `${percent}%`}
          </p>
          {phase === 'stopped' && (
            <div className="space-y-3">
              <p role="alert" className="text-sm">
                {FIRST_RUN_STOPPED}
              </p>
              <Button
                size="lg"
                className="h-[52px] w-full rounded-[14px] text-base"
                onClick={() => void download()}
              >
                Retry
              </Button>
            </div>
          )}
        </div>
      )}
    </PhoneScreen>
  )
}
