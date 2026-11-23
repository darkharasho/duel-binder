import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeftIcon, LayoutGridIcon, ListIcon, PlusIcon } from 'lucide-react'
import { toast } from 'sonner'
import { checkDeck, verdictMark, type DeckProblem } from '@shared/decks/check'
import { deckCost } from '@shared/decks/cost'
import { MAX_DECK_NAME, MAX_DECK_NOTES } from '@shared/decks/fields'
import { DECK_FORMATS, formatOf } from '@shared/decks/formats'
import { sortEntries } from '@shared/decks/sort'
import type { DeckCard, DeckDetail, DeckEntry, DeckFields } from '@shared/decks/types'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { api, queryKeys } from '@/lib/api'
import { useBackHandler } from '@/lib/backStack'
import { errorMessage } from '@/lib/errorMessage'
import { formatUsd } from '@/lib/format'
import { isPhone } from '@/lib/platform'
import { cn } from '@/lib/utils'
import { DeckAdder, type AdderTab } from './DeckAdder'
import {
  addEntry,
  changeQty,
  entryDomId,
  entryKey,
  moveEntry,
  pinEntry,
  removeEntry,
  shareOwned
} from './deckEntries'
import { DeckGrid } from './DeckGrid'
import { DeckHeader, DeckStatChips } from './DeckHeader'
import { DeckSectionList, type EntryActions } from './DeckSection'
import { ImportDialog } from './ImportDialog'
import { MissingList } from './MissingList'
import { ProblemsBar } from './ProblemsBar'
import { localToday, useRulesPack } from './useRulesPack'

const SAVE_MS = 600
const HIGHLIGHT_MS = 3000
const VIEW_KEY = 'decks.view'
/** From here up the adder sits beside the deck; below, it's a bottom sheet (as the filter panel). */
const WIDE = '(min-width: 1024px)'

type DeckView = 'grid' | 'list'
function readView(): DeckView {
  try {
    return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'grid'
  } catch {
    return 'grid'
  }
}

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
  const known = fields ? formatOf(game, fields.format) : null
  // A format from a newer app: the cards still show, in the game's usual sections, read-only.
  const format = fields ? (known ?? DECK_FORMATS[game][0] ?? null) : null
  const editable = !readOnly && known !== null
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

  // Marks the verdict seen on open, as soon as one is made against a pack, and again whenever an
  // edit changes it, so a deck fixed here doesn't read "Changed" once the next list comes out.
  const marked = useRef<string | null>(null)
  const mark = verdict ? verdictMark(verdict) : null
  const markKey = mark ? JSON.stringify(mark) : null
  useEffect(() => {
    if (readOnly || !markKey || marked.current === markKey) return
    marked.current = markKey
    api.decks
      .markSeen(uid, JSON.parse(markKey))
      .then(() => qc.invalidateQueries({ queryKey: queryKeys.decks, exact: true }))
      .catch(() => {})
  }, [readOnly, markKey, uid, qc])

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
        if (mine === seq.current) setSaveError(errorMessage(e, 'Could not save'))
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
  const [importing, setImporting] = useState(false)

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
      toast.error(errorMessage(e, 'Could not duplicate the deck'))
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
      toast.error(errorMessage(e, 'Could not delete the deck'))
      setBusy(false)
    }
  }

  const actions: EntryActions | undefined =
    editable && format
      ? {
          onQty: (e, d) => editCards((c) => changeQty(c, e, d)),
          onPin: (e, p) => editCards((c) => pinEntry(c, e, p)),
          onRemove: (e) => editCards((c) => removeEntry(c, e)),
          onCover: (e) => edit({ cover: e.card }),
          onMove: (e, section) => editCards((c) => moveEntry(c, e, section)),
          sections: format.sections
        }
      : undefined
  const addCard = (card: DeckCard, section: DeckEntry['section']): void => {
    setAdded((a) => ({ ...a, [card.id]: card }))
    editCards((c) => addEntry(c, card.id, section))
  }
  const phone = isPhone()

  const [view, setView] = useState<DeckView>(readView)
  const pickView = (v: DeckView): void => {
    setView(v)
    try {
      localStorage.setItem(VIEW_KEY, v)
    } catch {
      // Kept for this visit only.
    }
  }
  const [tab, setTab] = useState<AdderTab>('add')
  // The bottom sheet (phones, narrow windows, read-only Missing): which tab it opened on.
  const [sheet, setSheet] = useState<AdderTab | null>(null)
  const [problemsOpen, setProblemsOpen] = useState(false)
  const problemsRef = useRef<HTMLDivElement>(null)

  const counts = useMemo(() => {
    const out: Record<string, number> = {}
    for (const s of sections) out[s.def.id] = s.entries.reduce((n, e) => n + e.qty, 0)
    return out
  }, [sections])
  const inDeck = useMemo(() => {
    const out = new Map<number, number>()
    for (const e of fields?.cards ?? []) out.set(e.card, (out.get(e.card) ?? 0) + e.qty)
    return out
  }, [fields])
  const flagged = useMemo(() => {
    const out = new Map<number, 'error' | 'warning'>()
    for (const p of verdict?.problems ?? [])
      if (p.cardId !== undefined && out.get(p.cardId) !== 'error') out.set(p.cardId, p.severity)
    return out
  }, [verdict])
  const totals = useMemo(() => {
    const all = sections.flatMap((s) => s.entries)
    const copies = all.reduce((n, e) => n + e.qty, 0)
    const own = all.reduce((n, e) => n + (have.get(entryKey(e)) ?? 0), 0)
    const region = format?.priceRegion ?? 'en'
    let value = 0
    for (const e of all) {
      const c = facts[e.card]
      const unit = (region === 'asia' ? c?.regionPrice : c?.price) ?? null
      if (unit !== null) value += unit * e.qty
    }
    // Yu-Gi-Oh!: the Main Deck's monsters, spells and traps.
    const kinds = { monsters: 0, spells: 0, traps: 0 }
    if (game === 'ygo')
      for (const e of all) {
        if (e.section !== 'main') continue
        const type = facts[e.card]?.type ?? ''
        if (type.includes('Monster')) kinds.monsters += e.qty
        else if (type.includes('Spell')) kinds.spells += e.qty
        else if (type.includes('Trap')) kinds.traps += e.qty
      }
    return { copies, own, value, kinds }
  }, [sections, have, facts, format, game])
  // One Piece: the Leader's colours, the adder's colour chips.
  const leaderColors = useMemo(() => {
    const leader = fields?.cards.find((e) => e.section === 'leader')
    return game === 'op' && leader ? (facts[leader.card]?.opColors ?? []) : []
  }, [fields, facts, game])
  const missingCopies = cost ? cost.missing.reduce((n, m) => n + m.copies, 0) : 0

  const wide = (): boolean => !phone && (window.matchMedia?.(WIDE).matches ?? true)
  const openMissing = (): void => {
    if (editable && wide()) setTab('missing')
    else setSheet('missing')
  }
  const openProblems = (): void => {
    setProblemsOpen(true)
    problemsRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' })
  }

  const missingNode =
    cost && format && fields ? (
      <MissingList cost={cost} cards={facts} priceRegion={format.priceRegion} />
    ) : null
  const notesNode = fields ? (
    <textarea
      aria-label="Notes"
      placeholder="Plans, side choices, what to buy first…"
      value={fields.notes}
      maxLength={MAX_DECK_NOTES}
      onChange={(e) => edit({ notes: e.target.value })}
      className="min-h-40 w-full flex-1 resize-none rounded-md border bg-black/20 px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
    />
  ) : null
  const adder = (className?: string): React.JSX.Element | null =>
    format && fields ? (
      <DeckAdder
        game={game}
        format={format}
        inDeck={inDeck}
        tab={sheet ?? tab}
        onTab={(t) => (sheet ? setSheet(t) : setTab(t))}
        missingCount={missingCopies}
        missing={missingNode}
        notes={notesNode}
        onAdd={addCard}
        leaderColors={leaderColors}
        className={className}
      />
    ) : null
  const pane = 'rounded-xl border border-white/10 bg-black/25 backdrop-blur-sm'

  return (
    <div
      className={cn(
        'flex flex-col gap-3 p-8 max-md:p-4',
        phone ? 'pb-6' : 'lg:h-full lg:min-h-0 lg:pb-5'
      )}
    >
      {q.isError || q.isPending || !fields || !format ? (
        <>
          <Button variant="ghost" size="sm" className="-ml-2 self-start" onClick={onBack}>
            <ChevronLeftIcon className="size-4" />
            Back
          </Button>
          {q.isError ? (
            <p className="text-sm text-destructive">Could not load the deck.</p>
          ) : q.isPending ? (
            <p className="text-sm text-muted-foreground">Loading the deck…</p>
          ) : (
            <p className="text-sm text-muted-foreground">{"This deck isn't here any more."}</p>
          )}
        </>
      ) : (
        <>
          <DeckHeader
            game={game}
            fields={fields}
            facts={facts}
            known={known}
            editable={editable}
            readOnly={readOnly}
            verdict={verdict}
            busy={busy}
            confirmingDelete={confirmingDelete}
            onBack={onBack}
            onName={(name) => edit({ name })}
            onFormat={(format) => edit({ format })}
            onBadge={openProblems}
            menu={{
              onReplace: () => setImporting(true),
              onDuplicate: () => void duplicate(),
              onDelete: () => setConfirmingDelete(true),
              onPrivate: (on) => edit({ private: on })
            }}
            onConfirmDelete={() => void remove()}
            onKeep={() => setConfirmingDelete(false)}
          />
          {!known && (
            <p role="status" className="text-sm text-muted-foreground">
              {"This deck's format needs a newer version of the app. Update to check or edit it."}
            </p>
          )}
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
          <DeckStatChips
            format={format}
            counts={counts}
            own={totals.own}
            total={totals.copies}
            missing={cost && cost.missing.length > 0 ? formatUsd(cost.total) : null}
            onMissing={openMissing}
          />
          <div className="flex min-h-0 flex-1 gap-4">
            {editable && !phone && (
              <aside
                aria-label="Add cards"
                className={cn(pane, 'flex w-80 shrink-0 flex-col p-3 max-lg:hidden')}
              >
                {adder('flex-1')}
              </aside>
            )}
            <div className={cn(pane, 'flex min-w-0 flex-1 flex-col')}>
              <div
                className={cn('flex-1 space-y-4 p-3', !phone && 'lg:min-h-0 lg:overflow-y-auto')}
              >
                <div ref={problemsRef}>
                  <ProblemsBar
                    verdict={verdict}
                    expanded={problemsOpen}
                    onExpanded={setProblemsOpen}
                    onProblem={showProblem}
                  />
                </div>
                {view === 'grid' ? (
                  <DeckGrid
                    sections={sections}
                    cards={facts}
                    printingArt={detail?.printingArt ?? {}}
                    have={have}
                    cover={fields.cover}
                    highlight={highlight}
                    flagged={flagged}
                    phone={phone}
                    actions={actions}
                    onDropCard={editable ? addCard : undefined}
                  />
                ) : (
                  <div className="space-y-6">
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
                  </div>
                )}
              </div>
              <footer className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-white/10 px-3 py-2 font-mono text-xs">
                {game === 'ygo' && (
                  <>
                    <span>
                      <span className="text-muted-foreground">Monsters </span>
                      {totals.kinds.monsters}
                    </span>
                    <span>
                      <span className="text-muted-foreground">Spells </span>
                      {totals.kinds.spells}
                    </span>
                    <span>
                      <span className="text-muted-foreground">Traps </span>
                      {totals.kinds.traps}
                    </span>
                  </>
                )}
                <div
                  role="group"
                  aria-label="Deck view"
                  className="ml-auto flex items-center rounded-full bg-chip p-0.5"
                >
                  {(
                    [
                      ['grid', 'Grid', LayoutGridIcon],
                      ['list', 'List', ListIcon]
                    ] as const
                  ).map(([id, label, Icon]) => (
                    <button
                      key={id}
                      type="button"
                      aria-pressed={view === id}
                      onClick={() => pickView(id)}
                      className={cn(
                        'flex h-6 items-center gap-1 rounded-full px-2 outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        view === id ? 'bg-chip-on text-chip-on-ink' : 'hover:bg-chip'
                      )}
                    >
                      <Icon className="size-3" />
                      {label}
                    </button>
                  ))}
                </div>
                <span>
                  <span className="text-muted-foreground">Deck value </span>
                  <span className="font-semibold">{formatUsd(totals.value)}</span>
                </span>
              </footer>
            </div>
          </div>
          {editable && (
            <div
              className={cn(
                'pointer-events-none sticky bottom-4 z-30 flex justify-end',
                !phone && 'lg:hidden'
              )}
            >
              <Button
                size="lg"
                className="pointer-events-auto shadow-lg"
                onClick={() => setSheet('add')}
              >
                <PlusIcon />
                Add
              </Button>
            </div>
          )}
          <Sheet open={sheet !== null} onOpenChange={(o) => !o && setSheet(null)}>
            <SheetContent
              side="bottom"
              className="h-[85dvh] rounded-t-2xl border-0 bg-popover p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
            >
              <SheetTitle className="sr-only">
                {editable ? 'Add cards' : 'Missing cards'}
              </SheetTitle>
              {editable ? (
                adder('min-h-0 flex-1')
              ) : (
                <div className="min-h-0 flex-1 overflow-y-auto pt-6">{missingNode}</div>
              )}
            </SheetContent>
          </Sheet>
          {importing && (
            <ImportDialog
              game={game}
              format={fields.format}
              replacing={{
                name: fields.name,
                count: fields.cards.reduce((n, e) => n + e.qty, 0)
              }}
              busy={false}
              onApply={(r) => {
                setAdded((a) => ({ ...a, ...Object.fromEntries(r.facts.map((c) => [c.id, c])) }))
                // Saved now, then read again: the new cards' facts come from the deck's own read.
                const next = { ...fields, cards: r.cards }
                setDraft(next)
                if (timer.current) clearTimeout(timer.current)
                timer.current = null
                pending.current = null
                void save(next).then(() => qc.invalidateQueries({ queryKey: queryKeys.deck(uid) }))
                setImporting(false)
              }}
              onClose={() => setImporting(false)}
            />
          )}
        </>
      )}
    </div>
  )
}
