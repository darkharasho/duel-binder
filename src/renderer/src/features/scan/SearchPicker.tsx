import { memo, useState } from 'react'
import { ChevronDownIcon } from 'lucide-react'
import { Popover } from 'radix-ui'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from '@/components/ui/command'
import { PrintingLabel } from '@/components/PrintingLabel'
import { cn } from '@/lib/utils'

export interface PickerOption {
  key: string
  label: string
  /** Lower-case text the search matches (every word must appear); the label when left out. */
  search?: string
  /**
   * A short code shown as a badge (a printing's code, a set's prefix), the label without it as
   * the title, and a note such as a language tag; the label is the plain-text form of them all.
   */
  badge?: string
  title?: string
  note?: string
}

/**
 * An option as the pickers show it: its badge, then its title truncated to fit, then its note;
 * just its label when it has no title. `compact` sizes the badge for a small trigger.
 */
export function OptionLabel({
  option,
  compact = false
}: {
  option: PickerOption
  compact?: boolean
}): React.JSX.Element {
  if (option.title === undefined) {
    return <span className="min-w-0 truncate">{option.label}</span>
  }
  return (
    <PrintingLabel
      chip={option.badge}
      title={option.title ?? option.label}
      chipClassName={compact ? 'px-1.5 py-0 text-[11px]' : undefined}
      className={compact ? 'gap-1.5' : undefined}
      tag={
        option.note && <span className="shrink-0 text-xs text-muted-foreground">{option.note}</span>
      }
    />
  )
}

/** Options shown at once; the search narrows the rest down. */
const MAX_SHOWN = 100

/** The options matching every word of the query, at most MAX_SHOWN of them. */
// eslint-disable-next-line react-refresh/only-export-components -- shared with the phone's picker sheet
export function matchOptions(options: readonly PickerOption[], query: string): PickerOption[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const shown: PickerOption[] = []
  for (const o of options) {
    if (shown.length >= MAX_SHOWN) break
    const text = o.search ?? o.label.toLowerCase()
    if (words.every((w) => text.includes(w))) shown.push(o)
  }
  return shown
}

/**
 * A dropdown with a search box, for long lists (sets, rarities, printings). The list exists only
 * while it's open and shows at most MAX_SHOWN matches, so thousands of options cost nothing
 * until then.
 */
export const SearchPicker = memo(function SearchPicker({
  label,
  value,
  options,
  onPick,
  placeholder = 'Choose…',
  searchPlaceholder = 'Search…',
  className,
  disabled = false,
  badges = false,
  renderTrigger
}: {
  /** The trigger's accessible name. */
  label: string
  /** The picked option's key, or null for none. */
  value: string | null
  options: readonly PickerOption[]
  onPick: (key: string) => void
  placeholder?: string
  searchPlaceholder?: string
  className?: string
  disabled?: boolean
  /** Lists each option as its badge, title and note, as the printing pickers do; else its label. */
  badges?: boolean
  /** The trigger's contents in place of the picked label and chevron (the phone's chips). */
  renderTrigger?: (picked: PickerOption | undefined) => React.ReactNode
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const picked = value === null ? undefined : options.find((o) => o.key === value)
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
          {renderTrigger ? (
            renderTrigger(picked)
          ) : (
            <>
              <span className={cn('truncate', !picked && 'text-muted-foreground')}>
                {picked?.label ?? placeholder}
              </span>
              <ChevronDownIcon className="size-4 shrink-0 opacity-50" />
            </>
          )}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          className={cn(
            'z-50 max-w-[calc(100vw-1rem)] rounded-md border bg-popover p-0 text-popover-foreground shadow-md',
            badges
              ? 'w-[max(var(--radix-popover-trigger-width),22rem)]'
              : 'w-[max(var(--radix-popover-trigger-width),18rem)]'
          )}
        >
          <PickerList
            options={options}
            searchPlaceholder={searchPlaceholder}
            badges={badges}
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

function PickerList({
  options,
  searchPlaceholder,
  badges,
  onPick
}: {
  options: readonly PickerOption[]
  searchPlaceholder: string
  badges: boolean
  onPick: (key: string) => void
}): React.JSX.Element {
  const [query, setQuery] = useState('')
  const shown = matchOptions(options, query)
  return (
    // cmdk names its search box after its own label, so the label is what gives it a name.
    <Command shouldFilter={false} label={searchPlaceholder} className="rounded-md">
      <CommandInput
        autoFocus
        placeholder={searchPlaceholder}
        value={query}
        onValueChange={setQuery}
      />
      <CommandList className="max-h-80">
        <CommandEmpty>Nothing matches.</CommandEmpty>
        <CommandGroup>
          {shown.map((o) => (
            <CommandItem key={o.key} value={o.key} onSelect={() => onPick(o.key)}>
              {badges ? <OptionLabel option={o} /> : o.label}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </Command>
  )
}
