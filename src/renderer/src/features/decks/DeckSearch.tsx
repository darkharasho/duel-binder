import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { PlusIcon } from 'lucide-react'
import { defaultSection, type DeckFormat } from '@shared/decks/formats'
import { mtgPackOf } from '@shared/decks/pack'
import type { DeckCard, DeckSection } from '@shared/decks/types'
import type { GameId } from '@shared/games'
import { CardArt } from '@/components/CardArt'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { api } from '@/lib/api'
import { OP_DECK_TYPES, deckCardOf } from './deckEntries'
import { useRulesPack } from './useRulesPack'

const TYPE_MS = 250
const RESULTS = 20

/** Finds cards to add; each lands in the picked section, or by default where its frame goes. */
export function DeckSearch({
  game,
  format,
  commanders = 0,
  onAdd
}: {
  game: GameId
  format: DeckFormat
  /** Magic Commander: cards already in the Commander section; an empty one takes a commander. */
  commanders?: number
  onAdd: (card: DeckCard, section: DeckSection) => void
}): React.JSX.Element {
  const mtgPack = mtgPackOf(useRulesPack(game))
  const [text, setText] = useState('')
  const [q, setQ] = useState('')
  const [target, setTarget] = useState<DeckSection | 'auto'>('auto')
  const [ownedOnly, setOwnedOnly] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), TYPE_MS)
    return () => clearTimeout(t)
  }, [text])
  const results = useQuery({
    queryKey: ['browse', 'deckSearch', q, ownedOnly],
    queryFn: () =>
      api.cards.browse({
        q,
        owned: ownedOnly ? 'owned' : 'all',
        // One Piece: never DON!!, which no deck holds.
        ...(game === 'op' ? { opCardTypes: OP_DECK_TYPES } : {}),
        sort: 'name',
        dir: 'asc',
        limit: RESULTS
      }),
    enabled: q.length > 0
  })
  return (
    <div className="space-y-2 rounded-lg border bg-card/60 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label="Search cards"
          placeholder="Search cards to add"
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="min-w-48 flex-1"
        />
        <div className="flex items-center gap-1.5 text-sm">
          <span aria-hidden>Add to</span>
          <Select value={target} onValueChange={(v) => setTarget(v as DeckSection | 'auto')}>
            <SelectTrigger aria-label="Add to">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">
                {game === 'ygo' ? 'Main or Extra, by card' : 'Where the card goes'}
              </SelectItem>
              {format.sections.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <label className="flex items-center gap-1.5 text-sm">
          <Checkbox checked={ownedOnly} onCheckedChange={(c) => setOwnedOnly(c === true)} />
          Only cards I own
        </label>
      </div>
      {q.length > 0 &&
        (results.isError ? (
          <p className="text-xs text-destructive">Could not search the cards.</p>
        ) : results.isPending ? (
          <p className="text-xs text-muted-foreground">Searching…</p>
        ) : results.data.cards.length === 0 ? (
          <p className="text-xs text-muted-foreground">No cards found.</p>
        ) : (
          <ul
            aria-label="Search results"
            className="max-h-80 divide-y divide-white/[0.06] overflow-y-auto"
          >
            {results.data.cards.map((c) => {
              const card = deckCardOf(c)
              return (
                <li key={c.id} className="flex items-center gap-3 py-1.5">
                  <CardArt
                    imageId={c.imageId}
                    size="small"
                    alt=""
                    className="w-8 shrink-0 rounded-[2px]"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm">{c.name}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {`${c.type}${c.owned > 0 ? ` · ${c.owned} owned` : ''}`}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Add ${c.name}`}
                    onClick={() =>
                      onAdd(
                        card,
                        target === 'auto'
                          ? defaultSection(
                              game,
                              card,
                              game === 'mtg'
                                ? { format: format.id, commanders, pack: mtgPack }
                                : undefined
                            )
                          : target
                      )
                    }
                  >
                    <PlusIcon />
                  </Button>
                </li>
              )
            })}
          </ul>
        ))}
    </div>
  )
}
