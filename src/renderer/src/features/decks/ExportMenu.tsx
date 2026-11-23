import { DownloadIcon } from 'lucide-react'
import type { DeckCard, DeckEntry } from '@shared/decks/types'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import type { GameId } from '@shared/games'
import { exportDeck } from './deckExport'

/** Copy the deck as text or a ydke:// link, or save it as a .ydk file; Pokémon copies its list. */
export function ExportMenu({
  game = 'ygo',
  name,
  cards,
  facts
}: {
  game?: GameId
  name: string
  cards: DeckEntry[]
  facts: Record<number, DeckCard>
}): React.JSX.Element {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm">
          <DownloadIcon className="size-3.5" />
          Export
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {game === 'pkm' ? (
          <DropdownMenuItem onSelect={() => void exportDeck('text', name, cards, facts, game)}>
            Copy deck list
          </DropdownMenuItem>
        ) : (
          <>
            <DropdownMenuItem onSelect={() => void exportDeck('text', name, cards, facts)}>
              Copy as text
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void exportDeck('link', name, cards, facts)}>
              Copy ydke:// link
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void exportDeck('ydk', name, cards, facts)}>
              Save .ydk
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
