import type { FingerprintStatus } from '@shared/scan/types'
import { artDataText } from './scanText'

/** Why artwork matching is off, with how far along the download is. */
export function ArtDataNotice({
  status
}: {
  status: FingerprintStatus | null | undefined
}): React.JSX.Element {
  const progress = status?.state === 'downloading' ? status.progress : undefined
  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs text-muted-foreground">{artDataText(status)}</p>
      {progress !== undefined && (
        <div
          role="progressbar"
          aria-label="Artwork data download"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
          className="h-1 overflow-hidden rounded-full bg-white/10"
        >
          <div className="h-full bg-primary" style={{ width: `${progress * 100}%` }} />
        </div>
      )}
    </div>
  )
}
