import { useEffect, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

const DEBOUNCE_MS = 200

/**
 * The one search box: an icon, `type="search"`, h-9. Its text reaches `onChange` after a short
 * pause, so typing never re-renders the page under it; `debounceMs={0}` passes it on at once for
 * boxes that act on every key. Clearing `value` from outside clears the box. A box removed during
 * the pause (Bulk add swaps it out) hands over what was typed, so the text isn't lost.
 */
export function SearchInput({
  value,
  onChange,
  label,
  placeholder = label,
  debounceMs = DEBOUNCE_MS,
  className,
  inputClassName,
  inputRef,
  onKeyDown,
  autoFocus
}: {
  value: string
  onChange: (text: string) => void
  /** The box's accessible name. */
  label: string
  /** Says what the box matches: "Search sets by name or code". */
  placeholder?: string
  debounceMs?: number
  className?: string
  inputClassName?: string
  inputRef?: React.Ref<HTMLInputElement>
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>
  autoFocus?: boolean
}): React.JSX.Element {
  // Typed text still waiting out the pause; the box shows `value` the rest of the time.
  const [pending, setPending] = useState<string | null>(null)
  const latest = useRef(onChange)
  const waiting = useRef(pending)
  useEffect(() => {
    latest.current = onChange
    waiting.current = pending
  })
  useEffect(() => {
    if (pending === null) return
    const t = setTimeout(() => {
      latest.current(pending)
      setPending(null)
    }, debounceMs)
    return () => clearTimeout(t)
  }, [pending, debounceMs])
  useEffect(
    () => () => {
      if (waiting.current !== null) latest.current(waiting.current)
    },
    []
  )

  return (
    <div className={cn('relative', className)}>
      <Search
        aria-hidden
        className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        type="search"
        ref={inputRef}
        autoFocus={autoFocus}
        aria-label={label}
        placeholder={placeholder}
        value={pending ?? value}
        onChange={(e) => (debounceMs > 0 ? setPending(e.target.value) : onChange(e.target.value))}
        onKeyDown={onKeyDown}
        className={cn('pl-8', inputClassName)}
      />
    </div>
  )
}
