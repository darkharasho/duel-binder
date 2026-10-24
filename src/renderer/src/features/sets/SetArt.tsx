import { useState } from 'react'
import { cn } from '@/lib/utils'

interface SetArtProps {
  imageKey: string | null
  setCode: string
  /** Official pack render; zoomed to its front, ahead of everything else, when there. */
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
      <div className={cn('overflow-hidden rounded-md bg-muted', className)}>
        {/* The render is a product on a transparent square; zoom past the edges to its front. */}
        <img
          key={src}
          src={src}
          alt=""
          loading="lazy"
          draggable={false}
          onError={onError}
          className="size-full origin-[50%_40%] scale-[1.85] object-cover"
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
