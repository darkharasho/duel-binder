import { ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useScanHub } from './ScanHub'

/**
 * The scan page's "All slabs" switch: every card counted while it's on is taken as a graded slab
 * (held out of Add, for the graded-copy form), for slabs the scanner doesn't see as one.
 */
export function AssumeSlabToggle(): React.JSX.Element {
  const { settings, setSettings } = useScanHub()
  const on = settings.assumeSlab === true
  return (
    <Button
      variant={on ? 'default' : 'outline'}
      size="sm"
      aria-pressed={on}
      title={
        on
          ? 'Every card scanned counts as a graded slab'
          : 'Cards count as slabs only when the scanner sees a slab'
      }
      onClick={() => setSettings({ assumeSlab: !on })}
    >
      <ShieldCheck aria-hidden />
      All slabs
    </Button>
  )
}
