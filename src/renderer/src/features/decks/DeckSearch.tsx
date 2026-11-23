import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { PlusIcon } from 'lucide-react'
import { defaultSection, type DeckFormat } from '@shared/decks/formats'
import type { DeckCard, DeckSection } from '@shared/decks/types'
import type { GameId } from '@shared/games'
import type { BrowseCard } from '@shared/types'
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

const TYPE_MS = 250
const RESULTS = 20

/** What the deck needs of a search result, until the deck's own read brings the full facts. */
function deckCardOf(c: BrowseCard): DeckCard {
  return {
    id: c.id,
    name: c.name,
    type: c.type,
    frameType: c.frameType,
    imageId: c.imageId,
    owned: c.owned,
    price: c.price,
    regionPrice: null
  }
}

/** Finds cards to add; each lands in the picked section, or by default where its frame goes. */
export function DeckSearch({
  game,
  format,
  onAdd
}: {
  game: GameId
  format: DeckFormat
  onAdd: (card: DeckCard, section: DeckSection) => void
}): React.JSX.Element {
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
              <SelectItem value="auto">Main or Extra, by card</SelectItem>
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
                      onAdd(card, target === 'auto' ? defaultSection(game, card) : target)
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
