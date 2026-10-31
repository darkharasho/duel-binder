import { Button } from '@/components/ui/button'
import type { ScanStatus } from '@shared/scanWindow'

/** Takes a photo: the slower, closer look for a card live scanning can't name. */
export function PhotoButton({
  status,
  onClick,
  className
}: {
  status: ScanStatus
  onClick: () => void
  className?: string
}): React.JSX.Element {
  const unsure = status.kind === 'unsure' || status.kind === 'photo-failed'
  return (
    <Button
      variant={unsure ? 'default' : 'outline'}
      size="xs"
      className={className}
      disabled={status.kind === 'reading'}
      onClick={onClick}
    >
      Take photo
    </Button>
  )
}
