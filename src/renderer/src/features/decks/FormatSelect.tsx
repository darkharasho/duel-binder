import { DECK_FORMATS } from '@shared/decks/formats'
import type { GameId } from '@shared/games'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

/** The game's deck formats, in the app's own dropdown. */
export function FormatSelect({
  game,
  value,
  onChange,
  id,
  size,
  className
}: {
  game: GameId
  value: string
  onChange: (format: string) => void
  id?: string
  size?: 'sm' | 'default'
  className?: string
}): React.JSX.Element {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id} size={size} aria-label="Format" className={cn('w-full', className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {DECK_FORMATS[game].map((f) => (
          <SelectItem key={f.id} value={f.id}>
            {f.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
