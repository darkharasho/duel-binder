import { useId, useState } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import { setUsageEnabled, usageEnabled } from '@/lib/usage'

/** The opt-out for anonymous usage counts (see lib/usage.ts); remembered on this device. */
export function UsageToggle({ className }: { className?: string }): React.JSX.Element {
  const id = useId()
  const [on, setOn] = useState(usageEnabled)
  return (
    <div className={className ?? 'flex items-start gap-3 text-sm'}>
      <Checkbox
        id={id}
        checked={on}
        onCheckedChange={(c) => {
          setUsageEnabled(c === true)
          setOn(c === true)
        }}
        className="mt-0.5"
      />
      <label htmlFor={id} className="space-y-0.5">
        <span className="block">Share anonymous usage counts</span>
        <span className="block text-muted-foreground">
          How often pages are opened and cards are added, counted per day with nothing that
          identifies you.
        </span>
      </label>
    </div>
  )
}
