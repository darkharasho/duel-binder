import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { CheckIcon, XIcon } from 'lucide-react'
import { SearchInput } from '@/components/SearchInput'
import { matchOptions, type PickerOption } from '@/features/scan/SearchPicker'
import { cn } from '@/lib/utils'

/**
 * The phone's picker, as DexTCG does it: the trigger opens a rounded sheet from the bottom with a
 * title, a search box and the options as large rows, a set's code in a badge where Dex shows a
 * logo. The search box isn't focused on opening, so the keyboard doesn't cover the list.
 */
export function PickerSheet({
  label,
  title,
  value,
  options,
  onPick,
  searchPlaceholder = 'Search',
  className,
  disabled = false,
  children
}: {
  /** The trigger's accessible name. */
  label: string
  /** The sheet's heading. */
  title: string
  /** The picked option's key, or null for none. */
  value: string | null
  options: readonly PickerOption[]
  onPick: (key: string) => void
  searchPlaceholder?: string
  className?: string
  disabled?: boolean
  /** The trigger's contents. */
  children: React.ReactNode
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="dialog"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className={cn('flex items-center disabled:opacity-50', className)}
      >
        {children}
      </button>
      {open &&
        createPortal(
          <Sheet
            title={title}
            value={value}
            options={options}
            searchPlaceholder={searchPlaceholder}
            onPick={(key) => {
              onPick(key)
              setOpen(false)
            }}
            onClose={() => setOpen(false)}
          />,
          document.body
        )}
    </>
  )
}

function Sheet({
  title,
  value,
  options,
  searchPlaceholder,
  onPick,
  onClose
}: {
  title: string
  value: string | null
  options: readonly PickerOption[]
  searchPlaceholder: string
  onPick: (key: string) => void
  onClose: () => void
}): React.JSX.Element {
  const [query, setQuery] = useState('')
  const shown = matchOptions(options, query)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="dark fixed inset-0 z-50 text-foreground">
      <div
        aria-hidden
        className="absolute inset-0 bg-black/45 animate-in fade-in"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="absolute inset-x-2 bottom-[max(0.5rem,env(safe-area-inset-bottom))] flex max-h-[72%] flex-col rounded-[32px] border border-white/[0.1] bg-[#1c1c1f]/90 shadow-2xl backdrop-blur-2xl animate-in slide-in-from-bottom duration-200"
      >
        <header className="flex shrink-0 items-center justify-between gap-3 px-5 pb-3 pt-4">
          <h2 className="truncate text-[22px] font-bold">{title}</h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="flex size-11 shrink-0 items-center justify-center rounded-full border border-white/[0.13] bg-white/[0.07] active:bg-white/[0.14]"
          >
            <XIcon aria-hidden className="size-5" />
          </button>
        </header>
        <SearchInput
          label={searchPlaceholder}
          value={query}
          onChange={setQuery}
          debounceMs={0}
          className="mx-3 shrink-0"
          inputClassName="h-11 rounded-2xl border-0 bg-white/[0.07] text-base dark:bg-white/[0.07]"
        />
        <ul
          role="listbox"
          aria-label={title}
          className="mt-2.5 min-h-0 flex-1 space-y-2 overflow-auto overscroll-contain px-3 pb-3"
        >
          {shown.length === 0 && (
            <li className="py-8 text-center text-sm text-muted-foreground">Nothing matches.</li>
          )}
          {shown.map((o) => {
            const picked = o.key === value
            return (
              <li
                key={o.key}
                role="option"
                aria-selected={picked}
                tabIndex={0}
                onClick={() => onPick(o.key)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onPick(o.key)
                  }
                }}
                className={cn(
                  'flex min-h-16 cursor-pointer items-center gap-3.5 rounded-2xl border px-4 py-2 outline-none focus-visible:ring-2 focus-visible:ring-white/30 active:bg-white/[0.12]',
                  picked
                    ? 'border-emerald-300/40 bg-white/[0.1]'
                    : 'border-transparent bg-white/[0.06]'
                )}
              >
                {o.badge && (
                  <span className="flex h-8 min-w-14 shrink-0 items-center justify-center rounded-lg bg-white/[0.08] px-2 font-mono text-xs font-semibold tracking-wide text-white/85">
                    {o.badge}
                  </span>
                )}
                <span className="min-w-0 flex-1 truncate text-base leading-5">
                  {o.title ?? o.label}
                </span>
                {o.note && (
                  <span className="shrink-0 text-xs font-medium text-muted-foreground">
                    {o.note}
                  </span>
                )}
                {picked && <CheckIcon aria-hidden className="size-5 shrink-0 text-complete" />}
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
