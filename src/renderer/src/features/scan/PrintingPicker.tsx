import { memo, useEffect, useId, useMemo, useState } from 'react'
import { CheckIcon, ChevronRightIcon, SearchIcon } from 'lucide-react'
import { Popover } from 'radix-ui'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import {
  activeGroup,
  filterGroups,
  groupKeyOf,
  groupPrintings,
  groupText,
  type PrintingGroup
} from './printingGroups'
import type { PickerOption } from './SearchPicker'

/**
 * A scan row's printing dropdown in two parts: its sets on the left, one row each with its code
 * badge and name, and the versions of the set picked on the right, each with its rarity and note
 * (a price, a language). It opens on the set of the printing picked, with that printing marked.
 * The search narrows both sides; a card in one set shows its versions alone.
 *
 * Keys: up and down move in the column, left and right between them, Enter on a set moves to its
 * versions and on a version picks it.
 */
export const PrintingPicker = memo(function PrintingPicker({
  label,
  value,
  options,
  onPick,
  searchPlaceholder = 'Search…',
  className,
  disabled = false,
  renderTrigger
}: {
  /** The trigger's accessible name. */
  label: string
  /** The picked option's key, or null for none. */
  value: string | null
  options: readonly PickerOption[]
  onPick: (key: string) => void
  searchPlaceholder?: string
  className?: string
  disabled?: boolean
  /** The trigger's contents. */
  renderTrigger: (picked: PickerOption | undefined) => React.ReactNode
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const picked = value === null ? undefined : options.find((o) => o.key === value)
  const groups = useMemo(() => groupPrintings(options), [options])
  const split = groups.length > 1
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild disabled={disabled}>
        <button
          type="button"
          role="combobox"
          aria-label={label}
          aria-expanded={open}
          className={cn(
            'flex h-8 items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30 dark:hover:bg-input/50',
            className
          )}
        >
          {renderTrigger(picked)}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          className={cn(
            'z-50 max-w-[calc(100vw-1rem)] rounded-md border bg-popover p-0 text-popover-foreground shadow-md',
            split ? 'w-[40rem]' : 'w-[max(var(--radix-popover-trigger-width),22rem)]'
          )}
        >
          <PrintingPanel
            groups={groups}
            value={value}
            searchPlaceholder={searchPlaceholder}
            onPick={(key) => {
              onPick(key)
              setOpen(false)
            }}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
})

const ROW =
  'flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-hidden select-none'

function PrintingPanel({
  groups,
  value,
  searchPlaceholder,
  onPick
}: {
  groups: readonly PrintingGroup[]
  value: string | null
  searchPlaceholder: string
  onPick: (key: string) => void
}): React.JSX.Element {
  const id = useId()
  const split = groups.length > 1
  const [query, setQuery] = useState('')
  const shown = useMemo(() => filterGroups(groups, query), [groups, query])
  const [chosen, setChosen] = useState(() => groupKeyOf(groups, value))
  const active = activeGroup(shown, chosen)
  const [column, setColumn] = useState<'sets' | 'versions'>('versions')
  const [cursor, setCursor] = useState(value)
  const versions = active?.versions ?? []
  const lit =
    versions.find((v) => v.option.key === cursor) ??
    versions.find((v) => v.option.key === value) ??
    versions[0]
  const setIndex = active ? shown.indexOf(active) : -1
  const versionIndex = lit ? versions.indexOf(lit) : -1
  const setId = (i: number): string => `${id}-set-${i}`
  const versionId = (i: number): string => `${id}-version-${i}`
  const inSets = split && column === 'sets'
  const activeId = inSets
    ? setIndex >= 0 && setId(setIndex)
    : versionIndex >= 0 && versionId(versionIndex)

  useEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView?.({ block: 'nearest' })
  }, [activeId])
  // The picked set in view too, when it opens below the fold.
  useEffect(() => {
    if (split && setIndex >= 0) {
      document.getElementById(setId(setIndex))?.scrollIntoView?.({ block: 'nearest' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on opening
  }, [])

  const chooseSet = (g: PrintingGroup): void => {
    setChosen(g.key)
    setCursor(null)
  }
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
    const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0
    if (step !== 0) {
      e.preventDefault()
      if (inSets) {
        const next = shown[Math.min(Math.max(setIndex + step, 0), shown.length - 1)]
        if (next) chooseSet(next)
      } else {
        const next = versions[Math.min(Math.max(versionIndex + step, 0), versions.length - 1)]
        if (next) setCursor(next.option.key)
      }
    } else if (split && e.key === 'ArrowLeft') {
      e.preventDefault()
      setColumn('sets')
    } else if (split && e.key === 'ArrowRight') {
      e.preventDefault()
      setColumn('versions')
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (inSets) setColumn('versions')
      else if (lit) onPick(lit.option.key)
    }
  }

  const versionList = (
    <ul
      id={`${id}-versions`}
      role="listbox"
      aria-label={active && split ? `Versions in ${groupText(active)}` : 'Versions'}
      className="max-h-80 min-w-0 flex-1 overflow-y-auto p-1"
    >
      {versions.map((v, i) => {
        const isPicked = v.option.key === value
        return (
          <li
            key={v.option.key}
            id={versionId(i)}
            role="option"
            aria-selected={isPicked}
            aria-label={v.option.label}
            onClick={() => onPick(v.option.key)}
            onMouseMove={() => {
              setCursor(v.option.key)
              setColumn('versions')
            }}
            className={cn(ROW, v === lit && !inSets && 'bg-accent text-accent-foreground')}
          >
            <span className="min-w-0 flex-1 truncate" title={v.text}>
              {v.text}
            </span>
            {v.note && ' '}
            {v.note && (
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{v.note}</span>
            )}
            {isPicked && <CheckIcon aria-hidden className="size-4 shrink-0 text-complete" />}
          </li>
        )
      })}
    </ul>
  )

  return (
    <div>
      <div className="flex h-9 items-center gap-2 border-b px-3">
        <SearchIcon aria-hidden className="size-4 shrink-0 opacity-50" />
        <input
          autoFocus
          role="combobox"
          aria-label={searchPlaceholder}
          aria-expanded
          aria-controls={inSets ? `${id}-sets` : `${id}-versions`}
          aria-activedescendant={activeId || undefined}
          placeholder={searchPlaceholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          className="flex h-10 w-full rounded-md bg-transparent py-3 text-sm outline-hidden placeholder:text-muted-foreground"
        />
      </div>
      {shown.length === 0 ? (
        <p className="py-6 text-center text-sm">Nothing matches.</p>
      ) : split ? (
        <div className="flex">
          <ul
            id={`${id}-sets`}
            role="listbox"
            aria-label="Sets"
            className="max-h-80 w-[45%] shrink-0 overflow-y-auto border-r p-1"
          >
            {shown.map((g, i) => {
              const isActive = g === active
              return (
                <li
                  key={g.key}
                  id={setId(i)}
                  role="option"
                  aria-selected={isActive}
                  onClick={() => chooseSet(g)}
                  className={cn(
                    ROW,
                    isActive && (inSets ? 'bg-accent text-accent-foreground' : 'bg-accent/50')
                  )}
                >
                  <SetLabel group={g} />
                  <ChevronRightIcon
                    aria-hidden
                    className={cn('size-4 shrink-0 opacity-0', isActive && 'opacity-50')}
                  />
                </li>
              )
            })}
          </ul>
          {versionList}
        </div>
      ) : (
        <>
          {active && (active.badge || active.title) && (
            <div className="flex px-3 pt-2 text-xs text-muted-foreground">
              <SetLabel group={active} />
            </div>
          )}
          {versionList}
        </>
      )}
    </div>
  )
}

/** A set as the left column shows it: its code badge, then its name truncated to fit. */
function SetLabel({ group }: { group: PrintingGroup }): React.JSX.Element {
  return (
    <span className="flex min-w-0 flex-1 items-center gap-2" title={groupText(group)}>
      {group.badge && (
        <Badge variant="secondary" className="shrink-0 font-mono">
          {group.badge}
        </Badge>
      )}{' '}
      {group.title && <span className="min-w-0 truncate">{group.title}</span>}
    </span>
  )
}
