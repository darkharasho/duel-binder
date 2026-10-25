import { Undo2 } from 'lucide-react'
import { CardArt } from '@/components/CardArt'
import { Button } from '@/components/ui/button'

export interface AddedItem {
  id: number
  cardId: number
  printingId: number
  name: string
  rarity: string
  setCode: string
  imageId: number
}

const SHOWN = 8

/** The cards added this bulk session, newest first, each with an undo. */
export function JustAdded({
  items,
  onUndo
}: {
  items: AddedItem[]
  onUndo: (id: number) => void
}): React.JSX.Element | null {
  if (items.length === 0) return null
  const shown = items.slice(-SHOWN).reverse()
  return (
    <ul aria-label="Just added" className="space-y-1">
      {shown.map((item) => (
        <li key={item.id} className="flex items-center gap-2 rounded-md bg-card p-1 pr-1.5 text-xs">
          <CardArt
            imageId={item.imageId}
            size="small"
            alt={item.name}
            printingId={item.printingId}
            className="w-7 shrink-0"
          />
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium">{item.name}</div>
            <div className="truncate text-muted-foreground">
              {item.rarity} · <span className="tabular-nums">{item.setCode}</span>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Undo ${item.name} ${item.rarity}`}
            title="Undo"
            onClick={() => onUndo(item.id)}
          >
            <Undo2 />
          </Button>
        </li>
      ))}
    </ul>
  )
}
