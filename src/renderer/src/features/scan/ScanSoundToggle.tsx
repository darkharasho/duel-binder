import { Volume2, VolumeX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useScanPingSetting } from '@/lib/useScanPing'

/** The scan page's button for the ping when a card is found. */
export function ScanSoundToggle(): React.JSX.Element {
  const [on, set] = useScanPingSetting()
  const Icon = on ? Volume2 : VolumeX
  return (
    <Button
      variant="outline"
      size="sm"
      aria-pressed={on}
      title={on ? 'A soft ping plays when a card is found' : 'No sound when a card is found'}
      onClick={() => set(!on)}
    >
      <Icon aria-hidden />
      {on ? 'Sound on' : 'Sound off'}
    </Button>
  )
}
