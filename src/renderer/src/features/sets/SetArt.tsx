import { useState } from 'react'
import { cn } from '@/lib/utils'

interface SetArtProps {
  imageKey: string | null
  setCode: string
  /** Artwork of the set's headline card; shown cropped in place of the pack photo when there. */
  coverImageId?: number | null
  className?: string
}

export function SetArt({
  imageKey,
  setCode,
  coverImageId,
  className
}: SetArtProps): React.JSX.Element {
  const [failed, setFailed] = useState<{ cover: boolean; pack: boolean }>({
    cover: false,
    pack: false
  })
  const src =
    coverImageId != null && !failed.cover
      ? `ygo-img://cropped/${coverImageId}`
      : imageKey !== null && !failed.pack
        ? `ygo-img://set/${imageKey}`
        : null
  if (src === null) {
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
  const isCover = src.startsWith('ygo-img://cropped/')
  return (
    <img
      key={src}
      src={src}
      alt=""
      loading="lazy"
      draggable={false}
      onError={() => setFailed((f) => (isCover ? { ...f, cover: true } : { ...f, pack: true }))}
      className={cn('rounded-md bg-muted object-cover', className)}
    />
  )
}
