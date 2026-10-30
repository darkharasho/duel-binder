import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { CloudAuthError } from '../main/cloud/client'
import { FIRST_RUN_CELLULAR, FIRST_RUN_SIZE, FIRST_RUN_STOPPED, FIRST_RUN_TITLE } from './copy'
import type { PhoneStore } from './data/store'
import { refreshAllFingerprints } from './refreshFingerprints'
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
  const [progress, setProgress] = useState<{ cursor: number; latest: number | null }>({
    cursor: 0,
    latest: null
  })

  const live = useMounted()

  const download = async (): Promise<void> => {
    setPhase('downloading')
    try {
      const c = await store.catalog()
      if (live.current) setProgress({ cursor: c.cursor, latest: c.latest })
      await store.fillCatalog((p) => {
        if (live.current) setProgress(p)
      })
      // Artwork matching needs them; scanning by set code and name works without.
      await refreshAllFingerprints(store)
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

  const percent =
    progress.latest && progress.latest > 0
      ? Math.min(100, Math.round((progress.cursor / progress.latest) * 100))
      : null

  return (
    <PhoneScreen>
      <div className="w-full max-w-xs space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">{FIRST_RUN_TITLE}</h1>
        <p className="text-base text-muted-foreground">
          {cellular ? FIRST_RUN_CELLULAR : FIRST_RUN_SIZE}
        </p>
      </div>
      {phase === 'ask' ? (
        <Button
          size="lg"
          className="h-12 w-full max-w-xs text-base"
          onClick={() => void download()}
        >
          Download
        </Button>
      ) : (
        <div className="w-full max-w-xs space-y-3">
          <div
            role="progressbar"
            aria-label={FIRST_RUN_TITLE}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent ?? undefined}
            className="h-2 overflow-hidden rounded-full bg-white/10"
          >
            <div
              className={
                percent === null
                  ? 'h-full w-1/3 animate-pulse rounded-full bg-primary'
                  : 'h-full rounded-full bg-primary transition-[width] duration-300'
              }
              style={percent === null ? undefined : { width: `${percent}%` }}
            />
          </div>
          <p className="text-sm text-muted-foreground tabular-nums">
            {percent === null ? 'Starting…' : `${percent}%`}
          </p>
          {phase === 'stopped' && (
            <div className="space-y-3">
              <p role="alert" className="text-sm">
                {FIRST_RUN_STOPPED}
              </p>
              <Button size="lg" className="h-12 w-full text-base" onClick={() => void download()}>
                Retry
              </Button>
            </div>
          )}
        </div>
      )}
    </PhoneScreen>
  )
}
