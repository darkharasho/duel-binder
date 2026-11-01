import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { CARD_SIZES, useCardSize, type CardSize } from '@/lib/cardSize'

/**
 * Small, medium or large card tiles. Not on a phone's width, where the columns are fixed, or in
 * a bar an open side panel has left too narrow to hold it.
 */
export function CardSizePicker(): React.JSX.Element {
  const [size, setSize] = useCardSize()
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      aria-label="Card size"
      value={size}
      onValueChange={(next) => next && setSize(next as CardSize)}
      className="shrink-0 max-md:hidden @max-[43rem]:hidden"
    >
      {CARD_SIZES.map((s) => (
        <ToggleGroupItem key={s.value} value={s.value} aria-label={s.name} title={s.name}>
          {s.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}
