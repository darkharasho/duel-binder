import { memo, useMemo } from 'react'
import { Minus, Plus, X } from 'lucide-react'
import { languageInfo } from '@shared/languages'
import { CardArt } from '@/components/CardArt'
import { Button } from '@/components/ui/button'
import { formatUsd } from '@/lib/format'
import { isPhone } from '@/lib/platform'
import { cn } from '@/lib/utils'
import type { ScanDraft } from './resolve'
import { SearchPicker, type PickerOption } from './SearchPicker'
import type { ScanRow } from './session'

// eslint-disable-next-line react-refresh/only-export-components -- shared with the phone's last-scan card
export const FLAG_TEXT: Record<NonNullable<ScanDraft['flag']>, string> = {
  'check-rarity': 'Check rarity',
  'pick-printing': 'Check printing',
  'other-set': 'From another set'
}

/**
 * What the row's dropdown offers, always only the row's card: the rarities its set code came in
 * when the code was read off the card, else every printing it was matched to, so a printing
 * picked for an art or name match can still be changed to another code. Each shows its code and
 * rarity, and its language when they differ; the search also matches the set's name.
 */
// eslint-disable-next-line react-refresh/only-export-components -- shared with the phone's last-scan card
export function choicesFor(row: ScanRow): PickerOption[] {
  const own = row.options.filter((o) => o.cardId === row.cardId)
  const shown =
    row.via === 'code' && row.printingId !== null && row.flag !== 'pick-printing'
      ? own.filter((o) => o.setCode === row.setCode)
      : own
  const languages = new Set(shown.map((o) => o.language)).size > 1
  return shown.map((o) => {
    const tag = languageInfo(o.language).tag
    const label = `${o.setCode} · ${o.rarity}${languages ? ` · ${tag}` : ''}`
    return {
      key: String(o.printingId),
      label,
      search: `${o.setCode} ${o.rarity} ${o.setName} ${tag}`.toLowerCase()
    }
  })
}

export interface ScanRowActions {
  setPrinting(key: string, printingId: number): void
  setQuantity(key: string, q: number): void
  remove(key: string): void
}

/** One entry on the scan session list. */
export const ScanRowItem = memo(function ScanRowItem({
  row,
  actions,
  highlighted = false,
  disabled = false
}: {
  row: ScanRow
  actions: ScanRowActions
  highlighted?: boolean
  /** While the list is being added to the collection, rows can't change under it. */
  disabled?: boolean
}): React.JSX.Element {
  const choices = useMemo(() => choicesFor(row), [row])
  // Rows saved before prices existed have no `price` key at all.
  const price = row.options.find((o) => o.printingId === row.printingId)?.price
  const { key } = row
  const { setPrinting } = actions
  const pick = useMemo(() => (v: string) => setPrinting(key, Number(v)), [key, setPrinting])
  return (
    <li
      className={cn(
        'flex items-start gap-3 border-l-2 py-2 pl-3 pr-2 transition-colors duration-700',
        row.flag ? 'border-amber-400' : 'border-transparent',
        highlighted ? 'bg-emerald-400/10' : 'bg-transparent'
      )}
    >
      <CardArt imageId={row.imageId} size="small" alt="" className="w-10 shrink-0" />
      <div className="min-w-0 flex-1 space-y-1">
        {/* On a phone the name gets its own line; beside the code and price it was cut short. */}
        <div className={cn('flex items-baseline gap-2', isPhone() && 'flex-wrap gap-y-0')}>
          <span className={cn('truncate text-sm font-medium', isPhone() && 'basis-full')}>
            {row.name}
          </span>
          {row.setCode && (
            <span className="shrink-0 font-mono text-xs text-muted-foreground">{row.setCode}</span>
          )}
          {price != null && (
            <span
              aria-label={`Price of ${row.name}`}
              className="ml-auto shrink-0 text-xs text-emerald-400 tabular-nums"
            >
              {formatUsd(price)}
            </span>
          )}
        </div>
        <SearchPicker
          label={`Rarity for ${row.name}`}
          value={row.printingId === null ? null : String(row.printingId)}
          options={choices}
          onPick={pick}
          placeholder="Choose a printing"
          searchPlaceholder="Search code, rarity or set…"
          className="h-7 w-full max-w-72 px-2 text-xs"
          disabled={disabled}
        />
        {row.flag && <p className="text-xs text-amber-300">{FLAG_TEXT[row.flag]}</p>}
        {row.error && <p className="text-xs text-destructive">{row.error}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          variant="outline"
          size="icon-xs"
          disabled={disabled}
          aria-label={`One fewer ${row.name}`}
          onClick={() => actions.setQuantity(row.key, row.quantity - 1)}
        >
          <Minus />
        </Button>
        <span
          aria-label={`Quantity of ${row.name}`}
          className="w-6 text-center text-sm tabular-nums"
        >
          {row.quantity}
        </span>
        <Button
          variant="outline"
          size="icon-xs"
          disabled={disabled}
          aria-label={`One more ${row.name}`}
          onClick={() => actions.setQuantity(row.key, row.quantity + 1)}
        >
          <Plus />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          disabled={disabled}
          aria-label={`Remove ${row.name}`}
          onClick={() => actions.remove(row.key)}
        >
          <X />
        </Button>
      </div>
    </li>
  )
})
