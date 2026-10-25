import { useState } from 'react'
import { cn } from '@/lib/utils'
import { cardImageSrc, setImageSrc } from '@/lib/images'

interface SetArtProps {
  imageKey: string | null
  setCode: string
  /** Official pack render; shown whole in front when there's no logo. */
  packImageKey?: string | null
  /** The set's logo; shown in front, ahead of any pack. */
  logoImageKey?: string | null
  /** Artwork of the set's headline card; blurred to fill the tile behind the logo or pack. */
  coverImageId?: number | null
  className?: string
}

type Front = 'logo' | 'pack' | 'set'

/** A set's logo (or else its pack, or else its code) floating over its headline card, blurred. */
export function SetArt({
  imageKey,
  setCode,
  packImageKey,
  logoImageKey,
  coverImageId,
  className
}: SetArtProps): React.JSX.Element {
  const [failed, setFailed] = useState<Record<Front | 'cover', boolean>>({
    logo: false,
    pack: false,
    set: false,
    cover: false
  })
  const fronts: [Front, string | null][] = [
    ['logo', logoImageKey ? setImageSrc(logoImageKey) : null],
    ['pack', packImageKey ? setImageSrc(packImageKey) : null],
    ['set', imageKey !== null ? setImageSrc(imageKey) : null]
  ]
  const front = fronts.find(([source, src]) => src !== null && !failed[source]) as
    [Front, string] | undefined
  const cover = coverImageId != null && !failed.cover ? cardImageSrc('cropped', coverImageId) : null
  // Without a headline card, the pack itself is blurred behind, so the tile is never flat.
  const backdrop = cover ?? (front && front[0] !== 'logo' ? front[1] : null)

  if (!front && !backdrop) {
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
  const fail = (source: Front | 'cover') => (): void => setFailed((f) => ({ ...f, [source]: true }))

  return (
    <div
      className={cn('@container relative isolate overflow-hidden rounded-md bg-muted', className)}
    >
      {backdrop && (
        <img
          key={backdrop}
          src={backdrop}
          alt=""
          aria-hidden
          data-testid="set-art-backdrop"
          loading="lazy"
          draggable={false}
          onError={cover ? fail('cover') : undefined}
          className="absolute inset-0 size-full scale-125 object-cover blur-[6px] brightness-[0.8] saturate-[1.2]"
        />
      )}
      <div className="absolute inset-0 flex items-center justify-center p-[8%]">
        {front ? (
          <img
            key={front[1]}
            src={front[1]}
            alt=""
            data-testid={`set-art-${front[0]}`}
            loading="lazy"
            draggable={false}
            onError={fail(front[0])}
            className={cn(
              'max-h-full max-w-full object-contain drop-shadow-[0_4px_10px_rgb(0_0_0/0.55)]',
              front[0] === 'logo' && 'max-w-[92%]',
              front[0] === 'set' && 'rounded-[2px]'
            )}
          />
        ) : (
          <span className="font-mono text-[clamp(0.6rem,18cqw,1.5rem)] font-bold tracking-wide text-white drop-shadow-[0_2px_6px_rgb(0_0_0/0.8)]">
            {setCode}
          </span>
        )}
      </div>
    </div>
  )
}
