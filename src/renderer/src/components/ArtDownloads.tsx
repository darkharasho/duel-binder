import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { downloadsLabel, MIN_SHOWN, useImageDownloads } from './useImageDownloads'

const count = (n: number): string => n.toLocaleString('en-US')

/**
 * A small floating notice with real counts while a page's art downloads (a first visit to the
 * sets, a game's first look). Never blocks the page, and goes once the queue is empty.
 */
export function ArtDownloads(): React.JSX.Element | null {
  const downloads = useImageDownloads()
  if (!downloads) return null
  const total = downloads.cards.total + downloads.sets.total
  const done = downloads.cards.done + downloads.sets.done
  if (total < MIN_SHOWN) return null

  const pct = Math.min(100, Math.round((done / total) * 100))
  const what = downloadsLabel(downloads)
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-5 z-40 flex justify-center px-6">
      <div
        role="status"
        data-testid="art-downloads"
        className={cn(
          'pointer-events-auto w-full max-w-sm rounded-lg border border-white/10 bg-background/75 px-4 py-3',
          'shadow-[0_12px_40px_rgb(0_0_0/0.5)] backdrop-blur-md duration-300 animate-in fade-in-0 slide-in-from-bottom-2'
        )}
      >
        <div className="flex items-center gap-2.5 text-sm">
          <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" aria-hidden />
          <span className="flex-1 truncate">Downloading {what}</span>
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            {count(done)} of {count(total)}
          </span>
        </div>
        <div
          role="progressbar"
          aria-label={`Downloading ${what}`}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={done}
          className="mt-2.5 h-1 overflow-hidden rounded-full bg-white/10"
        >
          <div
            className="h-full rounded-full bg-foreground/70 transition-[width] duration-300 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Saved for offline use, so this only happens once. Keep browsing.
        </p>
      </div>
    </div>
  )
}
