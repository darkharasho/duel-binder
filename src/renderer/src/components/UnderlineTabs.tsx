import { ToggleGroup as ToggleGroupPrimitive } from 'radix-ui'
import { cn } from '@/lib/utils'

interface Props<T extends string> {
  label: string
  value: T
  options: readonly { value: T; label: string }[]
  onChange: (value: T) => void
  className?: string
}

/** A page's main filter as underlined text tabs (single choice, radio semantics). */
export function UnderlineTabs<T extends string>({
  label,
  value,
  options,
  onChange,
  className
}: Props<T>): React.JSX.Element {
  return (
    <ToggleGroupPrimitive.Root
      type="single"
      aria-label={label}
      value={value}
      onValueChange={(v) => {
        const next = options.find((o) => o.value === v)
        if (next) onChange(next.value)
      }}
      className={cn('flex items-end gap-5', className)}
    >
      {options.map((o) => (
        <ToggleGroupPrimitive.Item
          key={o.value}
          value={o.value}
          className="-mb-px border-b-2 border-transparent pb-2 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring data-[state=on]:border-foreground data-[state=on]:font-semibold data-[state=on]:text-foreground"
        >
          {o.label}
        </ToggleGroupPrimitive.Item>
      ))}
    </ToggleGroupPrimitive.Root>
  )
}
