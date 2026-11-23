import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { defaultSection, type DeckFormat } from '@shared/decks/formats'
import type { DeckCard, DeckSection } from '@shared/decks/types'
import { MTG_COLOR_NAMES } from '@shared/games/magic'
import { pkmKind } from '@shared/decks/pokemon/keys'
import { isExtraFrame } from '@shared/decks/ygo/check'
import type { GameId } from '@shared/games'
import type { BrowseCard } from '@shared/types'
import { CardArt } from '@/components/CardArt'
import { SearchInput } from '@/components/SearchInput'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { api, queryKeys } from '@/lib/api'
import { cn } from '@/lib/utils'
import { DRAG_CARD, OP_DECK_TYPES, SECTION_HEADING, deckCardOf } from './deckEntries'

const RESULTS = 60

export type AdderTab = 'add' | 'missing' | 'notes'
type Kind = 'monster' | 'spell' | 'trap' | 'extra' | 'P' | 'T' | 'E' | OpKind | MtgKind
type MtgKind = 'Creature' | 'InstantSorcery' | 'Land'
type OpKind = 'Character' | 'Event' | 'Stage'

const YGO_KINDS: { id: Kind; label: string }[] = [
  { id: 'monster', label: 'Monster' },
  { id: 'spell', label: 'Spell' },
  { id: 'trap', label: 'Trap' },
  { id: 'extra', label: 'Extra' }
]
const PKM_KINDS: { id: Kind; label: string }[] = [
  { id: 'P', label: 'Pokémon' },
  { id: 'T', label: 'Trainer' },
  { id: 'E', label: 'Energy' }
]
/** One Piece types, filtered by card_type; with none on, OP_DECK_TYPES (never DON!!). */
const OP_KINDS: { id: Kind; label: string }[] = [
  { id: 'Character', label: 'Character' },
  { id: 'Event', label: 'Event' },
  { id: 'Stage', label: 'Stage' }
]
/** Magic types, filtered by the card's types (mtgTypes). */
const MTG_KINDS: { id: Kind; label: string; types: string[] }[] = [
  { id: 'Creature', label: 'Creature', types: ['Creature'] },
  { id: 'InstantSorcery', label: 'Instant/Sorcery', types: ['Instant', 'Sorcery'] },
  { id: 'Land', label: 'Land', types: ['Land'] }
]
const isMtgKind = (kind: Kind): kind is MtgKind =>
  kind === 'Creature' || kind === 'InstantSorcery' || kind === 'Land'
/** The colour chips (mtgColors), in colour-wheel order. */
const MTG_COLORS = [...Object.values(MTG_COLOR_NAMES), 'Colorless']
/** A colour identity as chip names: 'R' or 'Red' both read as Red, and Colorless is always in. */
function identityChips(identity: string[]): string[] {
  const names: string[] = Object.values(MTG_COLOR_NAMES)
  const picks = identity
    .map((c) => MTG_COLOR_NAMES[c as keyof typeof MTG_COLOR_NAMES] ?? c)
    .filter((c) => names.includes(c))
  return [...new Set([...picks, 'Colorless'])]
}
const isOpKind = (kind: Kind): kind is OpKind =>
  kind === 'Character' || kind === 'Event' || kind === 'Stage'
const KINDS_OF: Partial<Record<GameId, { id: Kind; label: string }[]>> = {
  ygo: YGO_KINDS,
  pkm: PKM_KINDS,
  op: OP_KINDS,
  mtg: MTG_KINDS
}
const EXTRA_TYPE = /Fusion|Synchro|XYZ|Link/i

/** Whether a Yu-Gi-Oh! type line ('Effect Monster', 'Spell Card') is of the kind. */
function typeIs(kind: Kind, type: string): boolean {
  if (isOpKind(kind)) return type === kind
  if (kind === 'P' || kind === 'T' || kind === 'E') return pkmKind(type) === kind
  const monster = type.includes('Monster')
  switch (kind) {
    case 'monster':
      return monster && !EXTRA_TYPE.test(type)
    case 'extra':
      return monster && EXTRA_TYPE.test(type)
    case 'spell':
      return type.includes('Spell')
    case 'trap':
      return type.includes('Trap')
    default:
      return false
  }
}
const cardIs = (kind: Kind, c: BrowseCard): boolean =>
  isMtgKind(kind)
    ? true
    : isOpKind(kind)
      ? c.type === kind
      : kind === 'P' || kind === 'T' || kind === 'E'
        ? pkmKind(c.type) === kind
        : kind === 'extra' || kind === 'monster'
          ? c.type.includes('Monster') && isExtraFrame(c.frameType) === (kind === 'extra')
          : typeIs(kind, c.type)

const TAB =
  'h-7 flex-none rounded-full px-3 font-mono text-xs font-medium after:hidden data-[state=active]:bg-chip data-[state=active]:font-medium'
const FILTER =
  'h-7 shrink-0 rounded-full px-3 font-mono text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring'

/** The pane beside the deck: find cards to add, what's left to buy, and notes. */
export function DeckAdder({
  game,
  format,
  inDeck,
  tab,
  onTab,
  missingCount,
  missing,
  notes,
  onAdd,
  leaderColors = [],
  identity,
  commanders = 0,
  className
}: {
  game: GameId
  format: DeckFormat
  /** Copies of each card already in the deck, over every section. */
  inDeck: Map<number, number>
  tab: AdderTab
  onTab: (tab: AdderTab) => void
  /** Copies still to buy, for the tab's label. */
  missingCount: number
  missing: React.ReactNode
  notes: React.ReactNode
  onAdd: (card: DeckCard, section: DeckSection) => void
  /** One Piece: the deck's Leader's colours, a filter chip each. */
  leaderColors?: string[]
  /** Magic Commander: the commanders' colour identity; those colour chips (and Colorless) start on. */
  identity?: string[]
  /** Magic Commander: cards in the Commander section; an empty one takes a legendary creature. */
  commanders?: number
  className?: string
}): React.JSX.Element {
  return (
    <Tabs
      value={tab}
      onValueChange={(v) => onTab(v as AdderTab)}
      className={cn('flex min-h-0 flex-col gap-3', className)}
    >
      <TabsList className="h-auto shrink-0 justify-start gap-1">
        <TabsTrigger value="add" className={TAB}>
          Add cards
        </TabsTrigger>
        <TabsTrigger value="missing" className={TAB}>
          {`Missing · ${missingCount}`}
        </TabsTrigger>
        <TabsTrigger value="notes" className={TAB}>
          Notes
        </TabsTrigger>
      </TabsList>
      <TabsContent value="add" className="flex min-h-0 flex-col">
        <AdderSearch
          game={game}
          format={format}
          inDeck={inDeck}
          onAdd={onAdd}
          leaderColors={leaderColors}
          identity={identity}
          commanders={commanders}
        />
      </TabsContent>
      <TabsContent value="missing" className="min-h-0 overflow-y-auto pr-1">
        {missing}
      </TabsContent>
      <TabsContent value="notes" className="flex min-h-0 flex-col">
        {notes}
      </TabsContent>
    </Tabs>
  )
}

function AdderSearch({
  game,
  format,
  inDeck,
  onAdd,
  leaderColors,
  identity,
  commanders
}: {
  game: GameId
  format: DeckFormat
  inDeck: Map<number, number>
  onAdd: (card: DeckCard, section: DeckSection) => void
  leaderColors: string[]
  identity?: string[]
  commanders: number
}): React.JSX.Element {
  const [text, setText] = useState('')
  const q = text.trim()
  const [owned, setOwned] = useState(false)
  const [kind, setKind] = useState<Kind | null>(null)
  const [colorPicks, setColorPicks] = useState<{ start: string; picks: string[] } | null>(null)
  const op = game === 'op'
  const mtg = game === 'mtg'
  // Magic: the chips start on the commanders' colours, and again whenever the commanders change.
  const start = mtg && identity ? identityChips(identity).join(',') : ''
  const mtgColors =
    colorPicks && colorPicks.start === start ? colorPicks.picks : start ? start.split(',') : []
  const input = useRef<HTMLInputElement>(null)
  const kinds = KINDS_OF[game] ?? []
  // A colour stays picked only while the Leader still has it.
  const colors = op
    ? (colorPicks?.picks ?? []).filter((c) => leaderColors.includes(c))
    : mtg
      ? mtgColors
      : []
  const colorKey = colors.join(',')
  const side = format.sections.find((s) => s.id === 'side')
  const labelOf = (id: DeckSection): string => format.sections.find((s) => s.id === id)?.label ?? id

  // '/' jumps to the search box, unless another box has the keys.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')) return
      const box = input.current
      // A hidden pane (the sheet's copy is the one shown) doesn't take it.
      if (!box || box.getClientRects().length === 0) return
      e.preventDefault()
      box.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const facets = useQuery({
    queryKey: queryKeys.browseFacets('all'),
    queryFn: () => api.cards.browseFacets(undefined),
    enabled: kind !== null && !op && !mtg
  })
  const cardTypes = useMemo(
    () =>
      kind && !op && !mtg && facets.data
        ? facets.data.cardTypes.filter((t) => typeIs(kind, t))
        : undefined,
    [kind, op, mtg, facets.data]
  )
  const nothingPicked = kind === null && colors.length === 0
  // With nothing typed or picked, the cards you own: something to add straight away.
  const yours = owned || (q === '' && nothingPicked)
  const results = useQuery({
    queryKey: ['browse', 'deckAdder', q, yours, kind, cardTypes?.length ?? 0, colorKey],
    queryFn: () =>
      api.cards.browse({
        q,
        owned: yours ? 'owned' : 'all',
        ...(op
          ? {
              opCardTypes: kind ? [kind] : OP_DECK_TYPES,
              ...(colorKey ? { opColors: colorKey.split(',') } : {})
            }
          : mtg
            ? {
                ...(kind ? { mtgTypes: MTG_KINDS.find((k) => k.id === kind)?.types } : {}),
                ...(colorKey ? { mtgColors: colorKey.split(',') } : {})
              }
            : cardTypes && cardTypes.length > 0
              ? { cardTypes }
              : {}),
        sort: 'name',
        dir: 'asc',
        limit: RESULTS
      }),
    enabled: kind === null || op || mtg || !facets.isPending
  })
  const shown = (results.data?.cards ?? []).filter((c) => !kind || cardIs(kind, c))

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <SearchInput
        value={text}
        onChange={setText}
        label="Search cards"
        placeholder="Search by name, type or text"
        inputRef={input}
        inputClassName="h-10 text-base md:text-base"
      />
      <div role="group" aria-label="Filters" className="flex flex-wrap gap-1.5">
        <button
          type="button"
          aria-pressed={owned}
          onClick={() => setOwned((o) => !o)}
          className={cn(FILTER, owned ? 'bg-chip-on text-chip-on-ink' : 'bg-chip hover:bg-chip/70')}
        >
          Owned
        </button>
        {kinds.map((k) => (
          <button
            key={k.id}
            type="button"
            aria-pressed={kind === k.id}
            onClick={() => setKind((cur) => (cur === k.id ? null : k.id))}
            className={cn(
              FILTER,
              kind === k.id ? 'bg-chip-on text-chip-on-ink' : 'bg-chip hover:bg-chip/70'
            )}
          >
            {k.label}
          </button>
        ))}
        {(op ? leaderColors : mtg ? MTG_COLORS : []).map((c) => {
          const cur = op ? (colorPicks?.picks ?? []) : mtgColors
          return (
            <button
              key={c}
              type="button"
              aria-pressed={colors.includes(c)}
              onClick={() =>
                setColorPicks({
                  start,
                  picks: cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]
                })
              }
              className={cn(
                FILTER,
                colors.includes(c) ? 'bg-chip-on text-chip-on-ink' : 'bg-chip hover:bg-chip/70'
              )}
            >
              {c}
            </button>
          )
        })}
      </div>
      <div className="-mr-2 min-h-0 flex-1 overflow-y-auto pr-2">
        {q === '' && nothingPicked && !owned && shown.length > 0 && (
          <h3 className={cn(SECTION_HEADING, 'mb-2 text-muted-foreground')}>Cards you own</h3>
        )}
        {results.isError ? (
          <p className="text-xs text-destructive">Could not search the cards.</p>
        ) : results.isPending ? (
          <p className="text-xs text-muted-foreground">Searching…</p>
        ) : shown.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {q === '' && nothingPicked
              ? 'Type a card name to find cards to add.'
              : 'No cards found.'}
          </p>
        ) : (
          <ul aria-label="Search results" className="grid grid-cols-3 gap-x-2 gap-y-3">
            {shown.map((c) => {
              const card = deckCardOf(c)
              const home = defaultSection(
                game,
                card,
                mtg ? { format: format.id, commanders } : undefined
              )
              const n = inDeck.get(c.id) ?? 0
              return (
                <li key={c.id} className="group/result relative min-w-0">
                  <button
                    type="button"
                    aria-label={`Add ${c.name}`}
                    title={`${c.name}: click adds to ${labelOf(home)}${side ? ', Shift-click to Side' : ''}`}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData(DRAG_CARD, JSON.stringify(card))
                      e.dataTransfer.effectAllowed = 'copy'
                    }}
                    onClick={(e) => onAdd(card, e.shiftKey && side ? 'side' : home)}
                    className="relative block w-full rounded-[5px] outline-none transition hover:brightness-110 focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <CardArt
                      imageId={c.imageId}
                      size="small"
                      alt=""
                      className="w-full rounded-[3px]"
                    />
                    {n > 0 && (
                      <span className="pointer-events-none absolute right-1 top-1 rounded-full bg-chip-on px-1.5 font-mono text-[10.5px] font-semibold leading-[18px] text-chip-on-ink">
                        {`${n} in deck`}
                      </span>
                    )}
                    {c.owned > 0 && (
                      <span className="pointer-events-none absolute bottom-1 left-1 rounded-full bg-black/75 px-1.5 font-mono text-[10.5px] font-semibold leading-[18px] text-white">
                        {`own ${c.owned}`}
                      </span>
                    )}
                  </button>
                  <div className="pointer-events-none absolute inset-x-1.5 top-[30%] flex flex-col gap-1 opacity-0 transition-opacity group-focus-within/result:pointer-events-auto group-focus-within/result:opacity-100 group-hover/result:pointer-events-auto group-hover/result:opacity-100 [@media(pointer:coarse)]:hidden">
                    <button
                      type="button"
                      aria-label={`Add ${c.name} to ${labelOf(home)}`}
                      onClick={() => onAdd(card, home)}
                      className="rounded-full bg-chip-on py-1 font-mono text-[11px] font-semibold text-chip-on-ink shadow outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {`+ ${labelOf(home).replace(/ Deck$/, '')}`}
                    </button>
                    {side && (
                      <button
                        type="button"
                        aria-label={`Add ${c.name} to ${side.label}`}
                        onClick={() => onAdd(card, 'side')}
                        className="rounded-full bg-black/80 py-1 font-mono text-[11px] font-semibold text-white shadow outline-none ring-1 ring-white/20 focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        + Side
                      </button>
                    )}
                  </div>
                  <div className="mt-1 truncate text-[11px]" title={c.name}>
                    {c.name}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
      <p className="shrink-0 text-[11px] leading-snug text-muted-foreground">
        {side
          ? 'Click adds to Main or Extra · Shift-click to Side · drag onto a section'
          : 'Click adds the card · drag onto a section'}
      </p>
    </div>
  )
}
