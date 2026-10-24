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
      className={cn('h-1 w-full overflow-hidden rounded-[2px] bg-white/10', className)}
    >
      <div
        className={cn('h-full rounded-[2px]', progress.complete ? 'bg-complete' : 'bg-foreground')}
        style={{ width: `${progress.percent}%` }}
      />
    </div>
  )
}
