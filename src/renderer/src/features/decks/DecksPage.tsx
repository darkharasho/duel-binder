import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { DeckEntry, DeckList } from '@shared/decks/types'
import type { NavigateFn } from '@/components/AppShell'
import { useArtWash } from '@/components/artWashContext'
import { EmptyHero } from '@/components/EmptyHero'
import { PageHeader } from '@/components/PageHeader'
import { PAGE_TITLE } from '@/components/pageHeaderContext'
import { Button } from '@/components/ui/button'
import { CardGridSkeleton } from '@/components/ui/loading'
import { api, queryKeys } from '@/lib/api'
import { errorMessage } from '@/lib/errorMessage'
import { useGame } from '@/lib/game'
import { DeckPage } from './DeckPage'
import { DeckTile } from './DeckTile'
import { DECK_FORMATS, formatOf } from '@shared/decks/formats'
import { ImportDialog, type ImportResult } from './ImportDialog'
import { NewDeckDialog } from './NewDeckDialog'
import { localToday, useRulesPack } from './useRulesPack'

const GRID = 'grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4 max-md:grid-cols-1'

/** The current game's decks; opening one shows it. With `friendId`, that friend's, read-only. */
export function DecksPage({
  friendId,
  friendHeader
}: {
  /** Accepted for the page contract; the list has nowhere to navigate yet. */
  onNavigate?: NavigateFn
  friendId?: number
  /** The friend's name and tabs, shown in place of the page title. */
  friendHeader?: React.ReactNode
} = {}): React.JSX.Element {
  const { game } = useGame()
  const qc = useQueryClient()
  const list = useQuery<DeckList>({
    queryKey: friendId === undefined ? queryKeys.decks : queryKeys.friendDecks(friendId, game),
    queryFn: () => (friendId === undefined ? api.decks.list() : api.friends.decks(friendId)),
    ...(friendId === undefined ? {} : { retry: false })
  })
  const pack = useRulesPack(game)
  const [uid, setUid] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [importing, setImporting] = useState(false)
  const [saving, setSaving] = useState(false)
  const decks = useMemo(() => list.data?.decks ?? [], [list.data])
  const washCards = useMemo(
    () =>
      uid ? undefined : decks.flatMap((d) => (d.coverImageId ? [{ imageId: d.coverImageId }] : [])),
    [uid, decks]
  )
  useArtWash(washCards)
  const readOnly = friendId !== undefined
  const today = localToday()

  const create = async (name: string, format: string, cards: DeckEntry[] = []): Promise<void> => {
    setSaving(true)
    try {
      const id = await api.decks.save({
        format,
        name,
        notes: '',
        cover: null,
        private: false,
        cards
      })
      await qc.invalidateQueries({ queryKey: queryKeys.decks })
      setCreating(false)
      setImporting(false)
      setUid(id)
    } catch (e) {
      toast.error(errorMessage(e, 'Could not create the deck'))
    } finally {
      setSaving(false)
    }
  }

  if (uid) return <DeckPage uid={uid} friendId={friendId} onBack={() => setUid(null)} />
  const empty = list.isSuccess && decks.length === 0
  return (
    <div className="space-y-4 p-8 max-md:p-4">
      <PageHeader>
        {friendHeader}
        <div className="flex items-center justify-between gap-3">
          {!friendHeader && <h1 className={PAGE_TITLE}>Decks</h1>}
          {!readOnly && list.isSuccess && !empty && (
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setImporting(true)}>
                Import
              </Button>
              <Button onClick={() => setCreating(true)}>New deck</Button>
            </div>
          )}
        </div>
      </PageHeader>
      {empty ? (
        readOnly ? (
          <p className="text-sm text-muted-foreground">No shared decks yet.</p>
        ) : (
          <EmptyHero
            id="no-decks"
            title="Build your first deck"
            blurb="Check a deck against the format's rules and see what's left to buy."
          >
            <div className="mt-7 flex justify-center gap-3">
              <Button size="lg" onClick={() => setCreating(true)}>
                New deck
              </Button>
              <Button size="lg" variant="outline" onClick={() => setImporting(true)}>
                Import
              </Button>
            </div>
          </EmptyHero>
        )
      ) : list.isError ? (
        <p className="text-sm text-destructive">Could not load the decks.</p>
      ) : list.isPending ? (
        <CardGridSkeleton label="Loading decks" count={6} className={GRID} />
      ) : (
        <ul className={GRID} aria-label="Decks">
          {decks.map((d) => (
            <DeckTile
              key={d.uid}
              deck={d}
              cards={list.data?.cardFacts ?? {}}
              pack={pack}
              today={today}
              onOpen={() => setUid(d.uid)}
            />
          ))}
        </ul>
      )}
      {creating && (
        <NewDeckDialog
          game={game}
          busy={saving}
          onCreate={(n, f) => void create(n, f)}
          onClose={() => setCreating(false)}
        />
      )}
      {importing && (
        <ImportDialog
          game={game}
          format={formatOf(game, 'advanced') ? 'advanced' : (DECK_FORMATS[game][0]?.id ?? '')}
          busy={saving}
          onApply={(r: ImportResult) => void create(r.name, r.format, r.cards)}
          onClose={() => setImporting(false)}
        />
      )}
    </div>
  )
}
