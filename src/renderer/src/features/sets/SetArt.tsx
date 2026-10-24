import { useState } from 'react'
import { cn } from '@/lib/utils'

interface SetArtProps {
  imageKey: string | null
  setCode: string
  /** Official pack render; shown whole, ahead of everything else, when there. */
  packImageKey?: string | null
  /** Artwork of the set's headline card; shown cropped in place of the pack photo when there. */
  coverImageId?: number | null
  className?: string
}

type Source = 'pack' | 'cover' | 'set'

export function SetArt({
  imageKey,
  setCode,
  packImageKey,
  coverImageId,
  className
}: SetArtProps): React.JSX.Element {
  const [failed, setFailed] = useState<Record<Source, boolean>>({
    pack: false,
    cover: false,
    set: false
  })
  const candidates: [Source, string | null][] = [
    ['pack', packImageKey ? `ygo-img://set/${packImageKey}` : null],
    ['cover', coverImageId != null ? `ygo-img://cropped/${coverImageId}` : null],
    ['set', imageKey !== null ? `ygo-img://set/${imageKey}` : null]
  ]
  const chosen = candidates.find(([source, src]) => src !== null && !failed[source])
  if (!chosen) {
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
  const [source, src] = chosen as [Source, string]
  const onError = (): void => setFailed((f) => ({ ...f, [source]: true }))
  if (source === 'pack') {
    return (
      <div className={cn('relative overflow-hidden rounded-md bg-muted', className)}>
        <img
          src={src}
          alt=""
          aria-hidden
          draggable={false}
          className="absolute inset-0 size-full scale-125 object-cover opacity-50 blur-xl saturate-150"
        />
        <img
          key={src}
          src={src}
          alt=""
          loading="lazy"
          draggable={false}
          onError={onError}
          className="relative size-full object-contain p-[6%] drop-shadow-[0_6px_10px_rgb(0_0_0/0.5)]"
        />
      </div>
    )
  }
  return (
    <img
      key={src}
      src={src}
      alt=""
      loading="lazy"
      draggable={false}
      onError={onError}
      className={cn('rounded-md bg-muted object-cover', className)}
    />
  )
}
