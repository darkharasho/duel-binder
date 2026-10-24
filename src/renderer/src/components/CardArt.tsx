import { useState } from 'react'
import { cn } from '@/lib/utils'

interface CardArtProps {
  imageId: number
  size: 'small' | 'full'
  alt: string
  className?: string
}

function CardBack({ className, label }: { className?: string; label: string }): React.JSX.Element {
  return (
    <svg
      role="img"
      aria-label={label}
      data-testid="card-art-placeholder"
      viewBox="0 0 421 614"
      className={cn('aspect-[421/614] rounded-[6px] shadow-sm', className)}
    >
      <rect width="421" height="614" fill="currentColor" className="text-zinc-300 dark:text-zinc-700" />
      <rect x="24" y="24" width="373" height="566" rx="8" fill="none" stroke="currentColor" strokeWidth="6" className="text-zinc-400 dark:text-zinc-500" />
      <ellipse cx="210.5" cy="307" rx="92" ry="132" fill="none" stroke="currentColor" strokeWidth="6" className="text-zinc-400 dark:text-zinc-500" />
    </svg>
  )
}

export function CardArt({ imageId, size, alt, className }: CardArtProps): React.JSX.Element {
  const [failed, setFailed] = useState(false)
  if (failed) return <CardBack className={className} label={alt} />
  return (
    <img
      src={`ygo-img://${size}/${imageId}`}
      alt={alt}
      loading="lazy"
      draggable={false}
      onError={() => setFailed(true)}
      className={cn('aspect-[421/614] rounded-[6px] bg-muted object-cover shadow-sm', className)}
    />
  )
}
