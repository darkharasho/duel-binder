import { useId } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import { useScanPingSetting } from '@/lib/useScanPing'

/** The opt-in for the soft ping when a scanner finds a card; remembered on this device. */
export function ScanPingToggle({ className }: { className?: string }): React.JSX.Element {
  const id = useId()
  const [on, setOn] = useScanPingSetting()
  return (
    <div className={className ?? 'flex items-start gap-3 text-sm'}>
      <Checkbox
        id={id}
        checked={on}
        onCheckedChange={(c) => setOn(c === true)}
        className="mt-0.5"
      />
      <label htmlFor={id} className="space-y-0.5">
        <span className="block">Play a soft ping when a card is found</span>
        <span className="block text-muted-foreground">While scanning, on this device.</span>
      </label>
    </div>
  )
}
