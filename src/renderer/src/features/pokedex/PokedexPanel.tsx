import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { GAMES } from '@shared/games'
import { speciesName } from '@shared/pokedex'
import type { PokedexCard } from '@shared/types'
import { CardArt } from '@/components/CardArt'
import { CardPlaceholder } from '@/components/CardPlaceholder'
import { Button } from '@/components/ui/button'
import { SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { api, queryKeys } from '@/lib/api'
import { cn } from '@/lib/utils'
import { DexSprite } from './PokedexGrid'
import { dexNumber } from './pokedexView'

/** Missing shows this many until "Show all". */
const FIRST_MISSING = 12

function CardTile({
  card,
  missing,
  onOpen
}: {
  card: PokedexCard
  missing: boolean
  onOpen: (cardId: number) => void
}): React.JSX.Element {
  const art = 'w-full rounded-[4px] shadow-[0_6px_16px_rgb(0_0_0/0.4)]'
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(card.cardId)}
        className="group w-full rounded-md p-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className={cn('relative block', missing && 'opacity-45 grayscale')}>
          {/* 0: the catalog has no image for this card; never ask for image 0. */}
          {card.imageId === 0 ? (
            <CardPlaceholder
              game="pkm"
              label={card.name}
              aspect={GAMES.pkm.cardAspect}
              className={art}
            />
          ) : (
            <CardArt imageId={card.imageId} size="small" alt={card.name} className={art} />
          )}
          {card.copies > 1 && (
            <span className="absolute right-1 top-1 rounded-full bg-primary px-1.5 font-mono text-[10px] font-semibold text-primary-foreground shadow">
              ×{card.copies}
            </span>
          )}
        </span>
        <span
          className={cn(
            'mt-1.5 block truncate text-xs font-medium',
            missing && 'text-muted-foreground'
          )}
        >
          {card.name}
        </span>
        <span className="block truncate text-[11px] text-muted-foreground">{card.setName}</span>
      </button>
    </li>
  )
}

function CardGroup({
  title,
  cards,
  missing,
  onOpen
}: {
  title: string
  cards: PokedexCard[]
  missing: boolean
  onOpen: (cardId: number) => void
}): React.JSX.Element {
  const [all, setAll] = useState(false)
  const shown = missing && !all ? cards.slice(0, FIRST_MISSING) : cards
  return (
    <section aria-label={title} className="space-y-2">
      <h3 className="text-sm font-semibold">
        {title} <span className="font-normal text-muted-foreground">{cards.length}</span>
      </h3>
      <ul className="grid grid-cols-3 gap-2">
        {shown.map((c) => (
          <CardTile key={c.cardId} card={c} missing={missing} onOpen={onOpen} />
        ))}
      </ul>
      {shown.length < cards.length && (
        <Button variant="ghost" size="sm" onClick={() => setAll(true)}>
          Show all {cards.length}
        </Button>
      )}
    </section>
  )
}

/**
 * One species: its sprite, name and number, then the cards of it you own and the ones you're
 * missing. Renders inside the page's `CardSheet` (a side panel, full screen on the phone).
 */
export function PokedexPanel({
  dexNo,
  onOpenCard
}: {
  dexNo: number
  onOpenCard: (cardId: number) => void
}): React.JSX.Element {
  const name = speciesName(dexNo) ?? dexNumber(dexNo)
  const species = useQuery({
    queryKey: queryKeys.pokedexSpecies(dexNo),
    queryFn: () => api.pokedex.species(dexNo)
  })
  const owned = species.data?.owned ?? []
  const missing = species.data?.missing ?? []
  const caught = owned.length > 0
  return (
    <div className="space-y-5 pb-6">
      <SheetHeader className="flex-row items-center gap-3">
        <DexSprite dexNo={dexNo} caught={caught} className="size-20 shrink-0" />
        <div className="min-w-0 space-y-0.5">
          <SheetTitle className="truncate text-lg">{name}</SheetTitle>
          <div className="font-mono text-xs text-muted-foreground">{dexNumber(dexNo)}</div>
          <SheetDescription>
            {species.isSuccess
              ? `you have ${owned.length} ${owned.length === 1 ? 'card' : 'cards'} · ${missing.length} missing`
              : species.isError
                ? "Couldn't load its cards"
                : 'Loading cards…'}
          </SheetDescription>
        </div>
      </SheetHeader>
      {species.isSuccess && (
        <div className="space-y-6 px-4">
          {owned.length === 0 && missing.length === 0 ? (
            <p className="text-sm text-muted-foreground">{`No cards of ${name} yet`}</p>
          ) : (
            <>
              {owned.length > 0 && (
                <CardGroup title="Yours" cards={owned} missing={false} onOpen={onOpenCard} />
              )}
              {missing.length > 0 && (
                <CardGroup title="Missing" cards={missing} missing onOpen={onOpenCard} />
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
