import { cn } from '@/lib/utils'
import type { Progress } from './setsView'

export function SetProgress({
  progress,
  className
}: {
  progress: Progress
  className?: string
}): React.JSX.Element {
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={progress.percent}
      className={cn('h-1.5 w-full overflow-hidden rounded-full bg-muted', className)}
    >
      <div
        className={cn('h-full rounded-full', progress.complete ? 'bg-emerald-500' : 'bg-primary')}
        style={{ width: `${progress.percent}%` }}
      />
    </div>
  )
}
