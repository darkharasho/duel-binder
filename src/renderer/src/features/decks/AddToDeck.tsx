import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { checkDeck } from '@shared/decks/check'
import { defaultSection } from '@shared/decks/formats'
import type { DeckCard, DeckDraft, DeckEntry, DeckList, DeckSummary } from '@shared/decks/types'
import type { GameId } from '@shared/games'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { api, queryKeys } from '@/lib/api'
import { errorMessage } from '@/lib/errorMessage'
import { addEntry } from './deckEntries'
import { NewDeckDialog } from './NewDeckDialog'
import { localToday, useRulesPack } from './useRulesPack'

/** The card as the deck checks see it, from the deck lists' facts or else the catalog. */
async function factOf(cardId: number, known: DeckCard | undefined): Promise<DeckCard | undefined> {
  if (known) return known
  const detail = await api.cards.get(cardId)
  if (!detail) return undefined
  const c = detail.card
  return {
    id: c.id,
    name: c.name,
    type: c.type,
    frameType: c.frameType,
    imageId: null,
    owned: 0,
    price: null,
    regionPrice: null
  }
}

/** A menu of the game's decks (and a new one) to put one copy of the card into. */
export function AddToDeck({ game, cardId }: { game: GameId; cardId: number }): React.JSX.Element {
  const qc = useQueryClient()
  const pack = useRulesPack(game)
  const [menuOpen, setMenuOpen] = useState(false)
  // Read when the menu opens, not with every card panel.
  const list = useQuery<DeckList>({
    queryKey: queryKeys.decks,
    queryFn: () => api.decks.list(),
    enabled: menuOpen
  })
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState(false)
  const decks = list.data?.decks ?? []

  /** Saves the draft with one more copy of the card, then says so (and what is wrong, if anything). */
  const add = async (base: DeckDraft & { uid?: string }, name: string): Promise<void> => {
    const fact = await factOf(cardId, list.data?.cardFacts[cardId])
    const cards: DeckEntry[] = addEntry(base.cards, cardId, defaultSection(game, fact))
    await api.decks.save({ ...base, cards })
    const facts = { ...list.data?.cardFacts, ...(fact ? { [cardId]: fact } : {}) }
    const verdict = checkDeck(
      { game, format: base.format, cards },
      facts,
      pack ?? { state: 'missing' },
      localToday()
    )
    const problem = verdict.problems.find((p) => p.severity === 'error' && p.cardId === cardId)
    toast.success(problem ? `Added to ${name}. ${problem.message}` : `Added to ${name}`)
    await qc.invalidateQueries({ queryKey: queryKeys.decks })
  }

  /** A save replaces the deck, so its notes, cover and privacy are read first and ride along. */
  const addTo = async (d: DeckSummary): Promise<void> => {
    const full = await api.decks.get(d.uid)
    if (!full) throw new Error('That deck is gone')
    await add(
      {
        uid: full.uid,
        format: full.format,
        name: full.name,
        notes: full.notes,
        cover: full.cover,
        private: full.private,
        cards: full.cards
      },
      full.name
    )
  }

  const run = async (go: () => Promise<void>): Promise<void> => {
    setBusy(true)
    try {
      await go()
    } catch (e) {
      toast.error(errorMessage(e, 'Could not add to the deck'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" disabled={busy}>
            Add to deck
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {list.isPending && <DropdownMenuItem disabled>Loading decks…</DropdownMenuItem>}
          {decks.map((d) => (
            <DropdownMenuItem key={d.uid} onSelect={() => void run(() => addTo(d))}>
              {d.name}
            </DropdownMenuItem>
          ))}
          {decks.length > 0 && <DropdownMenuSeparator />}
          <DropdownMenuItem onSelect={() => setCreating(true)}>New deck…</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {creating && (
        <NewDeckDialog
          game={game}
          busy={busy}
          onClose={() => setCreating(false)}
          onCreate={(name, format) =>
            void run(async () => {
              await add({ format, name, notes: '', cover: null, private: false, cards: [] }, name)
              setCreating(false)
            })
          }
        />
      )}
    </>
  )
}
