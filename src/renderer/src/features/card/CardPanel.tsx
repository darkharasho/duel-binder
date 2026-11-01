import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { Language } from '@shared/languages'
import type { CardSearchResult } from '@shared/types'
import { CardDetails } from '@/components/CardDetails'
import { PanelCardArt } from '@/components/PanelCardArt'
import type { PanelNav } from '@/components/panelNav'
import { PanelPrice } from '@/components/PanelPrice'
import { scanFor } from '@/components/scanFor'
import { Button } from '@/components/ui/button'
import { SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { EntryEditor } from '@/features/collection/EntryEditor'
import { FriendCopies } from '@/features/friends/FriendCopies'
import { FriendWants } from '@/features/friends/FriendWants'
import { api, queryKeys } from '@/lib/api'
import { useGame } from '@/lib/game'
import { isPhone } from '@/lib/platform'
import { rarityColor, rarityTextColor } from '@/lib/rarityColors'
import { cardTypeRows, type CardTypeRow } from './cardTypes'
import { CardTypeList } from './CardTypeList'

/** What a page already knows of a card, shown until the card's details load. */
export interface CardPanelSeed {
  name: string
  type: string
  imageId: number
  /** The card's cheapest price. */
  price: number | null
  defaultPrintingId: number | null
}

interface CardPanelProps {
  cardId: number
  /** The entry the panel opened on, when the page selected one. */
  entryId?: number
  /** The printing to show when there's no entry to; else the seed's default one. */
  printingId?: number | null
  seed?: CardPanelSeed
  /** Tells the page which entry is selected, for those that track it. */
  onSelectEntry?: (entryId: number) => void
  onClose: () => void
  /** Opens the full Add Card dialog (printing, quantity); hidden when omitted. */
  onMoreOptions?: (card: CardSearchResult, printingId: number) => void
  /** A line over the price, e.g. the card's set and number. */
  caption?: string
  /** The set the panel was opened from; its printings are listed first. */
  preferSet?: { setName: string; language: Language }
  /** Lists only preferSet's printings. */
  onlySet?: boolean
  nav?: PanelNav
}

/** The row the user picked, for the card and page entry they picked it on. */
interface Pick {
  cardId: number
  openedOn: number | undefined
  entryId: number | null
  printingId: number | null
}

/**
 * A card's side panel, owned or not: its art, the headline price of the selected row, and the list
 * of every type of the card. Selecting a row only changes what's shown: edits go to the selected
 * row's own entry. Rendered inside a CardSheet.
 */
export function CardPanel({
  cardId,
  entryId,
  printingId,
  seed,
  onSelectEntry,
  onClose,
  onMoreOptions,
  caption,
  preferSet,
  onlySet,
  nav
}: CardPanelProps): React.JSX.Element {
  const { def } = useGame()
  const detail = useQuery({
    queryKey: queryKeys.card(cardId),
    queryFn: () => api.cards.get(cardId)
  })
  const copies = useQuery({
    queryKey: queryKeys.forCard(cardId),
    queryFn: () => api.collection.forCard(cardId)
  })
  // Rows keep their order while the panel is open, so an add can't move one from under the cursor.
  const [ownedAtOpen, setOwnedAtOpen] = useState<{ cardId: number; ids: Set<number> } | null>(null)
  if (copies.data && ownedAtOpen?.cardId !== cardId)
    setOwnedAtOpen({ cardId, ids: new Set(copies.data.map((c) => c.printing.id)) })
  const rows = cardTypeRows({
    printings: detail.data?.printings ?? [],
    copies: copies.data ?? [],
    originalImageId: detail.data?.images[0]?.imageId,
    ownedAtOpen: ownedAtOpen?.cardId === cardId ? ownedAtOpen.ids : new Set(),
    preferSet,
    onlySet,
    openedPrintingId: printingId ?? seed?.defaultPrintingId
  })

  const [pick, setPick] = useState<Pick | null>(null)
  const want =
    pick?.cardId === cardId && pick.openedOn === entryId
      ? pick
      : { entryId: entryId ?? null, printingId: printingId ?? seed?.defaultPrintingId ?? null }
  // When the selected entry goes (its last copy removed on its row), stay on its printing.
  const [lastShown, setLastShown] = useState<{ cardId: number; printingId: number } | null>(null)
  const selected =
    rows.find((r) => r.entry !== undefined && r.entry.id === want.entryId) ??
    rows.find((r) => r.printing.id === want.printingId) ??
    rows.find((r) => lastShown?.cardId === cardId && r.printing.id === lastShown.printingId)
  if (selected && (lastShown?.cardId !== cardId || lastShown.printingId !== selected.printing.id))
    setLastShown({ cardId, printingId: selected.printing.id })

  const selectRow = (row: CardTypeRow): void => {
    setPick({
      cardId,
      openedOn: entryId,
      entryId: row.entry?.id ?? null,
      printingId: row.printing.id
    })
    if (row.entry) onSelectEntry?.(row.entry.id)
  }
  /** An edit moved the selection to another entry (it merged into that one). */
  const selectEntry = (id: number): void => {
    setPick({ cardId, openedOn: entryId, entryId: id, printingId: null })
    onSelectEntry?.(id)
  }

  const entry = selected?.entry
  const shown = selected?.printing
  const art = entry
    ? { imageId: entry.imageId, printingId: scanFor(entry) }
    : shown
      ? { imageId: seed?.imageId || detail.data?.images[0]?.imageId, printingId: shown.id }
      : seed
        ? {
            imageId: seed.imageId || detail.data?.images[0]?.imageId,
            printingId: seed.defaultPrintingId
          }
        : undefined
  // Keep the last art up while a stepped-to card loads, so the floated card stays put.
  const [lastArt, setLastArt] = useState(art)
  if (
    art?.imageId !== undefined &&
    (art.imageId !== lastArt?.imageId || art.printingId !== lastArt?.printingId)
  )
    setLastArt(art)
  const panelArt = art?.imageId !== undefined ? art : lastArt

  const info = detail.data?.card ?? entry?.card ?? rows[0]?.entry?.card
  const name = seed?.name ?? info?.name
  const typeLine = info
    ? [info.type, info.attribute, info.race].filter(Boolean).join(' · ')
    : (seed?.type ?? '')
  // Price the row shown; rarities of one card can differ by orders of magnitude. The card's
  // cheapest price stands in on Yu-Gi-Oh! only: Pokémon prices never cross a language.
  const fallback = def.id === 'ygo' ? (seed?.price ?? null) : null
  const price = shown?.setPrice ?? fallback
  const priceLabel =
    shown?.setPrice != null
      ? shown.setRarity
      : fallback !== null
        ? 'cheapest printing'
        : shown?.setRarity

  // The caption names the set the panel opened from, which a row of another set isn't in.
  const inPreferredSet =
    !shown ||
    !preferSet ||
    (shown.setName === preferSet.setName && shown.language === preferSet.language)

  const pokemonVersion = def.id === 'pkm' ? shown?.setRarity : undefined

  const moreFor = shown?.id ?? seed?.defaultPrintingId ?? rows[0]?.printing.id
  const list = (
    <CardTypeList
      key={cardId}
      cardId={cardId}
      cardName={name ?? ''}
      rows={rows}
      copies={copies.data}
      selectedKey={selected?.key}
      onSelect={selectRow}
    />
  )
  // The phone's full-screen sheet is long, so its list comes before the card text.
  const phone = isPhone()

  return (
    <>
      <SheetHeader>
        <SheetTitle>{name ?? 'Card'}</SheetTitle>
        <SheetDescription>{typeLine}</SheetDescription>
      </SheetHeader>
      <div className="space-y-5 px-4 pb-6">
        {panelArt?.imageId !== undefined && (
          <PanelCardArt
            imageId={panelArt.imageId}
            printingId={panelArt.printingId}
            alt={name ?? ''}
            nav={nav}
          />
        )}
        <div className="space-y-1">
          {/* Pokémon versions share their art, so nothing else shows which one is selected. */}
          {pokemonVersion && (
            <p
              data-testid="selected-version"
              className="mb-2 w-fit rounded-full px-3 py-1 text-sm font-semibold"
              style={{
                backgroundColor: rarityColor(pokemonVersion, 'pkm'),
                color: rarityTextColor(pokemonVersion, 'pkm')
              }}
            >
              {pokemonVersion}
            </p>
          )}
          {caption && inPreferredSet && (
            <p className="font-mono text-[13px] text-muted-foreground">{caption}</p>
          )}
          <PanelPrice entry={entry} price={price} label={priceLabel} plain={!!pokemonVersion} />
        </div>

        {phone && list}
        <CardDetails card={info} printing={shown} />
        {!phone && list}

        {entry && (
          <EntryEditor
            key={entry.id}
            entry={entry}
            printings={detail.data?.printings ?? []}
            onSelectEntry={selectEntry}
            onClose={onClose}
          />
        )}

        {onMoreOptions && moreFor !== undefined && moreFor !== null && name && (
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              onMoreOptions(
                {
                  id: cardId,
                  name,
                  type: info?.type ?? seed?.type ?? '',
                  defaultImageId: panelArt?.imageId ?? 0,
                  matchedSetCode: null
                },
                moreFor
              )
            }
          >
            More options…
          </Button>
        )}

        <FriendCopies cardId={cardId} />
        <FriendWants cardId={cardId} owned={(copies.data?.length ?? 0) > 0} />
      </div>
    </>
  )
}
