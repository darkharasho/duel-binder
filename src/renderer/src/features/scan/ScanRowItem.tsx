import { Minus, Plus, X } from 'lucide-react'
import { languageInfo } from '@shared/languages'
import type { ScanPrinting } from '@shared/scan/types'
import { CardArt } from '@/components/CardArt'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import type { ScanDraft } from './resolve'
import type { ScanRow } from './session'

const FLAG_TEXT: Record<NonNullable<ScanDraft['flag']>, string> = {
  'check-rarity': 'Check rarity',
  'pick-printing': 'Pick printing',
  'other-set': 'From another set'
}

/**
 * What the row's dropdown offers: every printing of the card while its printing is for the
 * user to pick, else the rarities its set code came in.
 */
function choicesFor(row: ScanRow): { option: ScanPrinting; label: string }[] {
  if (row.printingId === null || row.flag === 'pick-printing') {
    return row.options.map((o) => ({
      option: o,
      label: `${o.setCode} · ${o.rarity} · ${languageInfo(o.language).tag}`
    }))
  }
  return row.options
    .filter((o) => o.cardId === row.cardId && o.setCode === row.setCode)
    .map((o) => ({ option: o, label: o.rarity }))
}

export interface ScanRowActions {
  setPrinting(key: string, printingId: number): void
  setQuantity(key: string, q: number): void
  remove(key: string): void
}

/** One entry on the scan session list. */
export function ScanRowItem({
  row,
  actions,
  highlighted = false
}: {
  row: ScanRow
  actions: ScanRowActions
  highlighted?: boolean
}): React.JSX.Element {
  const choices = choicesFor(row)
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
        <div className="flex items-baseline gap-2">
          <span className="truncate text-sm font-medium">{row.name}</span>
          {row.setCode && (
            <span className="shrink-0 font-mono text-xs text-muted-foreground">{row.setCode}</span>
          )}
        </div>
        <Select
          value={row.printingId === null ? undefined : String(row.printingId)}
          onValueChange={(v) => actions.setPrinting(row.key, Number(v))}
        >
          <SelectTrigger
            size="sm"
            aria-label={`Rarity for ${row.name}`}
            className="h-7 w-full max-w-64 px-2 text-xs"
          >
            <SelectValue placeholder="Choose a printing" />
          </SelectTrigger>
          <SelectContent>
            {choices.map(({ option, label }) => (
              <SelectItem key={option.printingId} value={String(option.printingId)}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {row.flag && <p className="text-xs text-amber-300">{FLAG_TEXT[row.flag]}</p>}
        {row.error && <p className="text-xs text-destructive">{row.error}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          variant="outline"
          size="icon-xs"
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
          aria-label={`One more ${row.name}`}
          onClick={() => actions.setQuantity(row.key, row.quantity + 1)}
        >
          <Plus />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`Remove ${row.name}`}
          onClick={() => actions.remove(row.key)}
        >
          <X />
        </Button>
      </div>
    </li>
  )
}
