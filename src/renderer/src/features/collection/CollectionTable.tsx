import { createColumnHelper, tableFeatures, useTable } from '@tanstack/react-table'
import { ArrowDown, ArrowUp } from 'lucide-react'
import type { CollectionFilters, EntryView, SortKey } from '@shared/types'
import { CardArt } from '@/components/CardArt'
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
import { EntryValue, StaleBadge, displayTotal } from './EntryValue'

interface Props {
  entries: EntryView[]
  selectedId: number | null
  sort: CollectionFilters['sort']
  dir: CollectionFilters['dir']
  onSort: (key: SortKey) => void
  onSelect: (entry: EntryView) => void
}

const features = tableFeatures({})
const helper = createColumnHelper<typeof features, EntryView>()

/** Which columns drive the (server-side) sort. */
const SORT_BY: Record<string, SortKey> = { name: 'name', quantity: 'quantity', total: 'value' }

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
      />
    )
  }),
  helper.accessor((e) => e.card.name, {
    id: 'name',
    header: 'Name',
    cell: ({ row }) => (
      <div className="space-y-1">
        <div className="font-medium">{row.original.card.name}</div>
        <StaleBadge entry={row.original} />
      </div>
    )
  }),
  helper.accessor((e) => e.printing.setCode, {
    id: 'setCode',
    header: 'Set code',
    cell: ({ row }) => (
      <span className="inline-flex items-center gap-1.5">
        {row.original.printing.setCode}
        <LanguageTag language={row.original.printing.language} />
      </span>
    )
  }),
  helper.accessor((e) => e.printing.setName, { id: 'setName', header: 'Set' }),
  helper.accessor((e) => e.printing.setRarity, { id: 'rarity', header: 'Rarity' }),
  helper.accessor('quantity', {
    id: 'quantity',
    header: 'Qty',
    cell: ({ row }) => <span className="tabular-nums">{row.original.quantity}</span>
  }),
  helper.accessor('unitPrice', {
    id: 'unitPrice',
    header: 'Unit price',
    cell: ({ row }) => (
      <EntryValue entry={row.original} amount={row.original.unitPrice} />
    )
  }),
  helper.accessor('totalValue', {
    id: 'total',
    header: 'Total',
    cell: ({ row }) => (
      <EntryValue entry={row.original} amount={displayTotal(row.original)} />
    )
  })
])

export function CollectionTable({
  entries,
  selectedId,
  sort,
  dir,
  onSort,
  onSelect
}: Props): React.JSX.Element {
  const table = useTable({ features, columns, data: entries })

  return (
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
      <TableBody>
        {table.getRowModel().rows.map((row) => (
          <TableRow
            key={row.id}
            data-nav-key={row.original.id}
            data-state={row.original.id === selectedId ? 'selected' : undefined}
            onClick={() => onSelect(row.original)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSelect(row.original)
            }}
            tabIndex={0}
            className="cursor-pointer"
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
  )
}
