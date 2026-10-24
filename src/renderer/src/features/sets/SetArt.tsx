import { useState } from 'react'
import { cn } from '@/lib/utils'

interface SetArtProps {
  imageKey: string | null
  setCode: string
  className?: string
}

export function SetArt({ imageKey, setCode, className }: SetArtProps): React.JSX.Element {
  const [failed, setFailed] = useState(false)
  if (imageKey === null || failed) {
    return (
      <div
        data-testid="set-art-placeholder"
        className={cn(
          'flex items-center justify-center rounded-md bg-muted text-xs font-semibold tracking-wide text-muted-foreground',
          className
        )}
      >
        {setCode}
      </div>
    )
  }
  return (
    <img
      src={`ygo-img://set/${imageKey}`}
      alt=""
      loading="lazy"
      draggable={false}
      onError={() => setFailed(true)}
      className={cn('rounded-md bg-muted object-contain', className)}
    />
  )
}
