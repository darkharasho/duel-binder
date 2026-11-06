import { useEffect, useId, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { CheckIcon, ChevronDownIcon, XIcon } from 'lucide-react'
import { SearchInput } from '@/components/SearchInput'
import {
  filterGroups,
  groupKeyOf,
  groupPrintings,
  groupText,
  type PrintingGroup,
  type PrintingVersion
} from '@/features/scan/printingGroups'
import type { PickerOption } from '@/features/scan/SearchPicker'
import { cn } from '@/lib/utils'

/**
 * The phone's printing picker, the desktop's two-part dropdown (see PrintingPicker) made to fit a
 * narrow screen: a sheet like PickerSheet's listing the card's sets, each opening in place onto
 * its versions. It opens on the set of the printing picked, its versions showing and that one
 * marked, so changing the rarity stays one tap; another set is a tap to open, then a tap to pick.
 * The search narrows the sets and their versions, and a search down to one set opens it. A card
 * in one set lists its versions alone.
 */
export function PrintingSheet({
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

const BADGE =
  'flex h-8 min-w-14 shrink-0 items-center justify-center rounded-lg bg-white/[0.08] px-2 font-mono text-xs font-semibold tracking-wide text-white/85'

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
  const id = useId()
  const groups = useMemo(() => groupPrintings(options), [options])
  const split = groups.length > 1
  const [query, setQuery] = useState('')
  const shown = useMemo(() => filterGroups(groups, query), [groups, query])
  // The set open below its row; null once it's tapped shut.
  const [opened, setOpened] = useState<string | null>(
    () => groupKeyOf(groups, value) ?? groups[0]?.key ?? null
  )
  const only = shown.length === 1 ? shown[0] : undefined
  const isOpen = (g: PrintingGroup): boolean => g === only || g.key === opened

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  // The picked printing in view, when its set is far down the list.
  useEffect(() => {
    document.getElementById(`${id}-picked`)?.scrollIntoView?.({ block: 'nearest' })
  }, [id])

  const versionList = (g: PrintingGroup, className?: string): React.JSX.Element => (
    <ul
      id={`${id}-${shown.indexOf(g)}`}
      role="listbox"
      aria-label={split ? `Versions in ${groupText(g)}` : title}
      className={cn('space-y-2', className)}
    >
      {g.versions.map((v) => (
        <VersionRow
          key={v.option.key}
          version={v}
          picked={v.option.key === value}
          id={v.option.key === value ? `${id}-picked` : undefined}
          onPick={onPick}
        />
      ))}
    </ul>
  )

  const one = shown[0]
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
        <div className="mt-2.5 min-h-0 flex-1 overflow-auto overscroll-contain px-3 pb-3">
          {shown.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Nothing matches.</p>
          ) : !split && one ? (
            <>
              {(one.badge || one.title) && (
                <div className="mb-2 flex items-center gap-3 px-1">
                  {one.badge && <span className={BADGE}>{one.badge}</span>}
                  <span className="min-w-0 truncate text-sm text-muted-foreground">
                    {one.title}
                  </span>
                </div>
              )}
              {versionList(one)}
            </>
          ) : (
            <ul aria-label="Sets" className="space-y-2">
              {shown.map((g, i) => {
                const expanded = isOpen(g)
                const holdsPicked = g.versions.some((v) => v.option.key === value)
                return (
                  <li key={g.key}>
                    <button
                      type="button"
                      aria-expanded={expanded}
                      aria-controls={expanded ? `${id}-${i}` : undefined}
                      onClick={() => setOpened(expanded ? null : g.key)}
                      className={cn(
                        'flex min-h-16 w-full items-center gap-3.5 rounded-2xl border px-4 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-white/30 active:bg-white/[0.12]',
                        holdsPicked
                          ? 'border-emerald-300/40 bg-white/[0.1]'
                          : 'border-transparent bg-white/[0.06]'
                      )}
                    >
                      {g.badge && <span className={BADGE}>{g.badge}</span>}{' '}
                      <span className="min-w-0 flex-1 truncate text-base leading-5">{g.title}</span>
                      <span className="shrink-0 text-xs font-medium text-muted-foreground tabular-nums">
                        {g.versions.length}
                      </span>
                      <ChevronDownIcon
                        aria-hidden
                        className={cn(
                          'size-5 shrink-0 text-white/60 transition-transform',
                          expanded && 'rotate-180'
                        )}
                      />
                    </button>
                    {expanded && versionList(g, 'mt-2 ml-4')}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

function VersionRow({
  version,
  picked,
  id,
  onPick
}: {
  version: PrintingVersion
  picked: boolean
  id?: string
  onPick: (key: string) => void
}): React.JSX.Element {
  const { option, text, note } = version
  return (
    <li
      id={id}
      role="option"
      aria-selected={picked}
      aria-label={option.label}
      tabIndex={0}
      onClick={() => onPick(option.key)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onPick(option.key)
        }
      }}
      className={cn(
        'flex min-h-14 cursor-pointer items-center gap-3.5 rounded-2xl border px-4 py-2 outline-none focus-visible:ring-2 focus-visible:ring-white/30 active:bg-white/[0.12]',
        picked ? 'border-emerald-300/40 bg-white/[0.1]' : 'border-transparent bg-white/[0.06]'
      )}
    >
      <span className="min-w-0 flex-1 text-base leading-5">{text}</span>
      {note && (
        <span className="shrink-0 text-xs font-medium text-muted-foreground tabular-nums">
          {note}
        </span>
      )}
      {picked && <CheckIcon aria-hidden className="size-5 shrink-0 text-complete" />}
    </li>
  )
}
