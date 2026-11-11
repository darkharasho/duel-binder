import { createContext, useContext } from 'react'
import { printingReverseLook } from '@shared/reverseHolo'
import { createColumnHelper, tableFeatures, useTable } from '@tanstack/react-table'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { englishSetName } from '@shared/setNames'
import type { CollectionFilters, EntryView, SortKey } from '@shared/types'
import { CardArt } from '@/components/CardArt'
import { FavouriteHeart } from '@/components/FavouriteHeart'
import { scanFor } from '@/components/scanFor'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table'
import { LanguageTag } from '@/components/LanguageTag'
import type { Favourites } from '@/lib/favourites'
import { useGame } from '@/lib/game'
import { useChunkedList } from '@/lib/useChunkedList'
import { EntryValue, StaleBadge } from './EntryValue'
import { displayTotal } from './displayTotal'

interface Props {
  entries: EntryView[]
  selectedId: number | null
  sort: CollectionFilters['sort']
  dir: CollectionFilters['dir']
  onSort: (key: SortKey) => void
  onSelect: (entry: EntryView) => void
  /** The owner's favourites, for a heart on each row; left out on a friend's collection. */
  favourites?: Favourites
}

/** The table's favourites, for its name cells (columns are defined once, outside the table). */
const FavouritesOfTable = createContext<Favourites | undefined>(undefined)

/** A row's name, its stale badge, and the heart at the right of the name. */
function NameCell({ entry }: { entry: EntryView }): React.JSX.Element {
  const favourites = useContext(FavouritesOfTable)
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">{entry.card.name}</span>
        {favourites && (
          <FavouriteHeart cardId={entry.card.id} name={entry.card.name} favourites={favourites} />
        )}
      </div>
      <StaleBadge entry={entry} />
    </div>
  )
}

/** A column heading in the game's words ("Set code" and "Rarity" on Yu-Gi-Oh!). */
function GameWord({ word }: { word: 'printingCode' | 'rarity' }): string {
  return useGame().def.vocab[word]
}

const features = tableFeatures({})
const helper = createColumnHelper<typeof features, EntryView>()

/** Which columns drive the (server-side) sort. */
const SORT_BY: Record<string, SortKey> = {
  name: 'name',
  quantity: 'quantity',
  unitPrice: 'unitPrice',
  total: 'value'
}

const columns = helper.columns([
  helper.display({
    id: 'art',
    header: 'Art',
    cell: ({ row }) => (
      <CardArt
        imageId={row.original.imageId}
        printingId={scanFor(row.original)}
        size="small"
        alt=""
        className="w-8"
        reverse={printingReverseLook(row.original.printing, row.original.card)}
      />
    )
  }),
  helper.accessor((e) => e.card.name, {
    id: 'name',
    header: 'Name',
    cell: ({ row }) => <NameCell entry={row.original} />
  }),
  helper.accessor((e) => e.printing.setCode, {
    id: 'setCode',
    header: () => <GameWord word="printingCode" />,
    cell: ({ row }) => (
      <span className="inline-flex items-center gap-1.5">
        {row.original.printing.setCode}
        <LanguageTag language={row.original.printing.language} />
      </span>
    )
  }),
  helper.accessor((e) => englishSetName(e.printing.setName, e.printing.setCode), {
    id: 'setName',
    header: 'Set'
  }),
  helper.accessor((e) => e.printing.setRarity, {
    id: 'rarity',
    header: () => <GameWord word="rarity" />
  }),
  helper.accessor('quantity', {
    id: 'quantity',
    header: 'Qty',
    cell: ({ row }) => <span className="tabular-nums">{row.original.quantity}</span>
  }),
  helper.accessor('unitPrice', {
    id: 'unitPrice',
    header: 'Unit price',
    cell: ({ row }) => <EntryValue entry={row.original} amount={row.original.unitPrice} />
  }),
  helper.accessor('totalValue', {
    id: 'total',
    header: 'Total',
    cell: ({ row }) => <EntryValue entry={row.original} amount={displayTotal(row.original)} />
  })
])

export function CollectionTable({
  entries,
  selectedId,
  sort,
  dir,
  onSort,
  onSelect,
  favourites
}: Props): React.JSX.Element {
  const table = useTable({ features, columns, data: entries })
  // Thousands of rows at once hold the window; they arrive as the scroll nears them.
  const [rows, endRef] = useChunkedList(table.getRowModel().rows)

  return (
    <FavouritesOfTable.Provider value={favourites}>
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id}>
              {group.headers.map((header) => {
                const key = SORT_BY[header.column.id]
                const active = key !== undefined && key === sort
                return (
                  <TableHead
                    key={header.id}
                    aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}
                  >
                    {key ? (
                      <button
                        type="button"
                        onClick={() => onSort(key)}
                        className="inline-flex items-center gap-1 rounded outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <table.FlexRender header={header} />
                        {active &&
                          (dir === 'asc' ? (
                            <ArrowUp className="size-3" />
                          ) : (
                            <ArrowDown className="size-3" />
                          ))}
                      </button>
                    ) : (
                      <table.FlexRender header={header} />
                    )}
                  </TableHead>
                )
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody ref={endRef}>
          {rows.map((row) => (
            <TableRow
              key={row.id}
              data-nav-key={row.original.id}
              data-state={row.original.id === selectedId ? 'selected' : undefined}
              onClick={() => onSelect(row.original)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onSelect(row.original)
              }}
              tabIndex={0}
              className="group/tile cursor-pointer"
            >
              {row.getAllCells().map((cell) => (
                <TableCell key={cell.id}>
                  <table.FlexRender cell={cell} />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </FavouritesOfTable.Provider>
  )
}
