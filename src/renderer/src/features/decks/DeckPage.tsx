import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeftIcon } from 'lucide-react'
import { toast } from 'sonner'
import { checkDeck, verdictMark, type DeckProblem } from '@shared/decks/check'
import { deckCost } from '@shared/decks/cost'
import { MAX_DECK_NAME, MAX_DECK_NOTES } from '@shared/decks/fields'
import { formatOf } from '@shared/decks/formats'
import { sortEntries } from '@shared/decks/sort'
import type { DeckCard, DeckDetail, DeckEntry, DeckFields } from '@shared/decks/types'
import { PageHeader } from '@/components/PageHeader'
import { PAGE_TITLE } from '@/components/pageHeaderContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api, queryKeys } from '@/lib/api'
import { useBackHandler } from '@/lib/backStack'
import { isPhone } from '@/lib/platform'
import { cn } from '@/lib/utils'
import {
  addEntry,
  changeQty,
  entryDomId,
  entryKey,
  pinEntry,
  removeEntry,
  shareOwned
} from './deckEntries'
import { DeckSearch } from './DeckSearch'
import { DeckSectionList, type EntryActions } from './DeckSection'
import { FeedbackPanel } from './FeedbackPanel'
import { localToday, useRulesPack } from './useRulesPack'

const SAVE_MS = 600
const HIGHLIGHT_MS = 3000

const fieldsOf = (d: DeckDetail): DeckFields => ({
  format: d.format,
  name: d.name,
  notes: d.notes,
  cover: d.cover,
  private: d.private,
  cards: d.cards
})

/** One deck: its sections, live rules feedback and, for the owner, editing (saved as you go). */
export function DeckPage({
  uid,
  onBack,
  friendId
}: {
  uid: string
  onBack: () => void
  friendId?: number
}): React.JSX.Element {
  useBackHandler(true, onBack)
  const qc = useQueryClient()
  const readOnly = friendId !== undefined
  const q = useQuery({
    queryKey: friendId === undefined ? queryKeys.deck(uid) : queryKeys.friendDeck(friendId, uid),
    queryFn: () => (friendId === undefined ? api.decks.get(uid) : api.friends.deck(friendId, uid)),
    ...(friendId === undefined ? {} : { retry: false })
  })
  const detail = q.data ?? null
  // Edits live here from the first one on; until then the deck is what was read.
  const [draft, setDraft] = useState<DeckFields | null>(null)
  const fields = draft ?? (detail ? fieldsOf(detail) : null)
  const [added, setAdded] = useState<Record<number, DeckCard>>({})
  const facts = useMemo(() => ({ ...added, ...detail?.cardFacts }), [added, detail])
  const game = detail?.game ?? 'ygo'
  const pack = useRulesPack(game)
  const format = fields ? formatOf(game, fields.format) : null
  const today = localToday()

  const verdict = useMemo(
    () =>
      fields && pack
        ? checkDeck({ game, format: fields.format, cards: fields.cards }, facts, pack, today)
        : null,
    [fields, pack, facts, game, today]
  )
  const cost = useMemo(
    () => (fields && format ? deckCost(fields.cards, facts, format.priceRegion) : null),
    [fields, format, facts]
  )

  // Marks the verdict seen once on open, as soon as one is made against a pack.
  const marked = useRef(false)
  const mark = verdict ? verdictMark(verdict) : null
  useEffect(() => {
    if (readOnly || marked.current || !mark) return
    marked.current = true
    api.decks
      .markSeen(uid, mark)
      .then(() => qc.invalidateQueries({ queryKey: queryKeys.decks, exact: true }))
      .catch(() => {})
  }, [readOnly, mark, uid, qc])

  // Saving: debounced; the latest save's outcome is the one shown.
  const [saveError, setSaveError] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pending = useRef<DeckFields | null>(null)
  const seq = useRef(0)
  const save = useCallback(
    async (f: DeckFields): Promise<void> => {
      const mine = ++seq.current
      try {
        await api.decks.save({ ...f, uid })
        if (mine === seq.current) setSaveError(null)
        void qc.invalidateQueries({ queryKey: queryKeys.decks })
      } catch (e) {
        if (mine === seq.current) setSaveError(e instanceof Error ? e.message : 'Could not save')
      }
    },
    [uid, qc]
  )
  const flush = useCallback((): void => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    const f = pending.current
    pending.current = null
    if (f) void save(f)
  }, [save])
  // Leaving the page saves what is still waiting.
  useEffect(() => flush, [flush])

  const edit = (patch: Partial<DeckFields>): void => {
    if (!fields) return
    const next = { ...fields, ...patch }
    setDraft(next)
    pending.current = next
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(flush, SAVE_MS)
  }
  const editCards = (f: (cards: DeckEntry[]) => DeckEntry[]): void => {
    if (fields) edit({ cards: f(fields.cards) })
  }

  const [highlight, setHighlight] = useState<string | null>(null)
  useEffect(() => {
    if (!highlight) return
    const t = setTimeout(() => setHighlight(null), HIGHLIGHT_MS)
    return () => clearTimeout(t)
  }, [highlight])

  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [busy, setBusy] = useState(false)

  const sections = useMemo(
    () =>
      format && fields
        ? format.sections.map((def) => ({
            def,
            entries: sortEntries(
              game,
              fields.cards.filter((e) => e.section === def.id),
              facts
            )
          }))
        : [],
    [format, fields, game, facts]
  )
  const have = useMemo(
    () =>
      shareOwned(
        sections.flatMap((s) => s.entries),
        facts
      ),
    [sections, facts]
  )

  const showProblem = (p: DeckProblem): void => {
    const shown = sections.flatMap((s) => s.entries)
    const target =
      p.cardId === undefined
        ? undefined
        : shown.find((e) => e.card === p.cardId && (!p.section || e.section === p.section))
    const el = target
      ? document.getElementById(entryDomId(entryKey(target)))
      : p.section
        ? document.getElementById(`deck-section-${p.section}`)
        : null
    el?.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
    setHighlight(target ? entryKey(target) : null)
  }

  const duplicate = async (): Promise<void> => {
    if (!fields) return
    setBusy(true)
    const name = `${fields.name.slice(0, MAX_DECK_NAME - ' copy'.length)} copy`
    try {
      await api.decks.save({ ...fields, name })
      await qc.invalidateQueries({ queryKey: queryKeys.decks, exact: true })
      toast.success(`Saved as ${name}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not duplicate the deck')
    } finally {
      setBusy(false)
    }
  }
  const remove = async (): Promise<void> => {
    setBusy(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    pending.current = null
    try {
      await api.decks.remove(uid)
      await qc.invalidateQueries({ queryKey: queryKeys.decks, exact: true })
      onBack()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not delete the deck')
      setBusy(false)
    }
  }

  const actions: EntryActions | undefined = readOnly
    ? undefined
    : {
        onQty: (e, d) => editCards((c) => changeQty(c, e, d)),
        onPin: (e, p) => editCards((c) => pinEntry(c, e, p)),
        onRemove: (e) => editCards((c) => removeEntry(c, e)),
        onCover: (e) => edit({ cover: e.card })
      }
  const phone = isPhone()

  return (
    <div className={cn('space-y-4 p-8 max-md:p-4', phone && 'pb-24')}>
      <PageHeader>
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" className="-ml-2 shrink-0" onClick={onBack}>
            <ChevronLeftIcon className="size-4" />
            Back
          </Button>
          {readOnly || !fields ? (
            <h1 className={cn(PAGE_TITLE, 'min-w-0 truncate')}>{fields?.name ?? ''}</h1>
          ) : (
            <Input
              aria-label="Deck name"
              value={fields.name}
              maxLength={MAX_DECK_NAME}
              onChange={(e) => edit({ name: e.target.value })}
              className={cn(
                PAGE_TITLE,
                'h-auto min-w-0 flex-1 border-transparent px-1 shadow-none'
              )}
            />
          )}
        </div>
      </PageHeader>
      {q.isError ? (
        <p className="text-sm text-destructive">Could not load the deck.</p>
      ) : q.isPending ? (
        <p className="text-sm text-muted-foreground">Loading the deck…</p>
      ) : !fields || !format ? (
        <p className="text-sm text-muted-foreground">{"This deck isn't here any more."}</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            <span className="text-muted-foreground">{format.label}</span>
            {!readOnly && (
              <>
                <label className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={fields.private}
                    onChange={(e) => edit({ private: e.target.checked })}
                  />
                  Private
                </label>
                <Button variant="ghost" size="sm" disabled={busy} onClick={() => void duplicate()}>
                  Duplicate
                </Button>
                {confirmingDelete ? (
                  <span className="flex items-center gap-2">
                    <span>Delete this deck?</span>
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={busy}
                      onClick={() => void remove()}
                    >
                      Confirm delete
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setConfirmingDelete(false)}>
                      Keep
                    </Button>
                  </span>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive"
                    onClick={() => setConfirmingDelete(true)}
                  >
                    Delete
                  </Button>
                )}
              </>
            )}
          </div>
          {saveError && (
            <div
              role="alert"
              className="flex flex-wrap items-center gap-2 text-sm text-destructive"
            >
              <span>{`Not saved: ${saveError}`}</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  pending.current = fields
                  flush()
                }}
              >
                Retry
              </Button>
            </div>
          )}
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <div className="min-w-0 space-y-6">
              {!readOnly && (
                <DeckSearch
                  game={game}
                  format={format}
                  onAdd={(card, section) => {
                    setAdded((a) => ({ ...a, [card.id]: card }))
                    editCards((c) => addEntry(c, card.id, section))
                  }}
                />
              )}
              {sections.map((s) => (
                <DeckSectionList
                  key={s.def.id}
                  def={s.def}
                  entries={s.entries}
                  cards={facts}
                  printingArt={detail?.printingArt ?? {}}
                  have={have}
                  cover={fields.cover}
                  highlight={highlight}
                  actions={actions}
                />
              ))}
              {!readOnly && (
                <div className="space-y-1.5">
                  <label htmlFor="deck-notes" className="text-sm font-medium">
                    Notes
                  </label>
                  <textarea
                    id="deck-notes"
                    value={fields.notes}
                    maxLength={MAX_DECK_NOTES}
                    rows={4}
                    onChange={(e) => edit({ notes: e.target.value })}
                    className="w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>
              )}
            </div>
            <FeedbackPanel
              verdict={verdict}
              cost={cost}
              cards={facts}
              priceRegion={format.priceRegion}
              onProblem={showProblem}
            />
          </div>
        </>
      )}
    </div>
  )
}
