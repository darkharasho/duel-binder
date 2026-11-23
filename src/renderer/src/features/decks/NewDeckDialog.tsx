import { useState } from 'react'
import { DECK_FORMATS } from '@shared/decks/formats'
import type { GameId } from '@shared/games'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { FormatSelect } from './FormatSelect'

const NAME_MAX = 80

/** Asks for a name and a format; the caller saves the deck. */
export function NewDeckDialog({
  game,
  busy,
  onCreate,
  onClose
}: {
  game: GameId
  busy: boolean
  onCreate: (name: string, format: string) => void
  onClose: () => void
}): React.JSX.Element {
  const formats = DECK_FORMATS[game]
  const [name, setName] = useState('')
  const [format, setFormat] = useState(
    formats.find((f) => f.id === 'advanced')?.id ?? formats[0]?.id ?? ''
  )
  const ok = name.trim().length > 0 && !busy
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (ok) onCreate(name.trim(), format)
          }}
        >
          <DialogHeader>
            <DialogTitle>New deck</DialogTitle>
            <DialogDescription>
              {"Cards are checked against the format's limits as you build."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <label htmlFor="deck-name" className="text-sm font-medium">
              Name
            </label>
            <Input
              id="deck-name"
              value={name}
              maxLength={NAME_MAX}
              autoFocus
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="deck-format" className="text-sm font-medium">
              Format
            </label>
            <FormatSelect id="deck-format" game={game} value={format} onChange={setFormat} />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!ok}>
              Create deck
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
