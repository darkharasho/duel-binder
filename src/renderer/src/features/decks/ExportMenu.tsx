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

/**
 * Copy the deck as text or a ydke:// link, or save it as a .ydk file; Pokémon copies its list, One
 * Piece its list, OPlay deck code or OPlay link.
 */
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
        {game === 'op' ? (
          <>
            <DropdownMenuItem onSelect={() => void exportDeck('text', name, cards, facts, game)}>
              Copy deck list
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void exportDeck('oplay', name, cards, facts, game)}>
              Copy OPlay deck code
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => void exportDeck('oplayLink', name, cards, facts, game)}
            >
              Copy OPlay link
            </DropdownMenuItem>
          </>
        ) : game === 'mtg' ? (
          <>
            <DropdownMenuItem onSelect={() => void exportDeck('arena', name, cards, facts, game)}>
              Copy Arena list
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void exportDeck('mtgo', name, cards, facts, game)}>
              Copy MTGO list
            </DropdownMenuItem>
          </>
        ) : game === 'pkm' ? (
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
