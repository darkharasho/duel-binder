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
import { cn } from '@/lib/utils'

export interface PickerOption {
  key: string
  label: string
  /** Lower-case text the search matches (every word must appear); the label when left out. */
  search?: string
}

/** Options shown at once; the search narrows the rest down. */
const MAX_SHOWN = 100

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
  disabled = false
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
          <span className={cn('truncate', !picked && 'text-muted-foreground')}>
            {picked?.label ?? placeholder}
          </span>
          <ChevronDownIcon className="size-4 shrink-0 opacity-50" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          className="z-50 w-[max(var(--radix-popover-trigger-width),18rem)] rounded-md border bg-popover p-0 text-popover-foreground shadow-md"
        >
          <PickerList
            options={options}
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

function PickerList({
  options,
  searchPlaceholder,
  onPick
}: {
  options: readonly PickerOption[]
  searchPlaceholder: string
  onPick: (key: string) => void
}): React.JSX.Element {
  const [query, setQuery] = useState('')
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const shown: PickerOption[] = []
  for (const o of options) {
    if (shown.length >= MAX_SHOWN) break
    const text = o.search ?? o.label.toLowerCase()
    if (words.every((w) => text.includes(w))) shown.push(o)
  }
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
              {o.label}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </Command>
  )
}
