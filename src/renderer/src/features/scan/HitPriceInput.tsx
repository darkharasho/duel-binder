import { useState } from 'react'
import { cn } from '@/lib/utils'

/**
 * A dollar amount that commits on blur or Enter; anything but a number above 0 reverts. Shared by
 * the Scan page and the phone, which passes `text-base` so iOS doesn't zoom in on the field.
 */
export function HitPriceInput({
  value,
  onCommit,
  className
}: {
  value: number
  onCommit: (v: number) => void
  className?: string
}): React.JSX.Element {
  const [text, setText] = useState(String(value))
  const commit = (): void => {
    const n = Number(text)
    if (text.trim() !== '' && Number.isFinite(n) && n > 0) {
      onCommit(n)
      setText(String(n))
    } else setText(String(value))
  }
  return (
    <div className={cn('flex items-center gap-1.5 text-sm text-muted-foreground', className)}>
      <label htmlFor="scan-hit-price">Hit price</label>
      <span aria-hidden>$</span>
      <input
        id="scan-hit-price"
        type="number"
        min={0}
        step="any"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
        }}
        className="h-8 w-20 rounded-md border border-input bg-transparent px-2 text-foreground tabular-nums"
      />
    </div>
  )
}
