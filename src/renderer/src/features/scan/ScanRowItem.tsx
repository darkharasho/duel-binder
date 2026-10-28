import { memo, useMemo } from 'react'
import {
  ChevronDownIcon,
  MinusIcon,
  PlusIcon,
  StarIcon,
  TriangleAlertIcon,
  XIcon
} from 'lucide-react'
import { languageInfo, type Language } from '@shared/languages'
import { CardArt } from '@/components/CardArt'
import { formatUsd } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { ScanDraft } from './resolve'
import { GLASS, priceOf } from './scanLook'
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
 *
 * With a scan language (see useScanLanguage), only printings in it are listed, plus the row's own
 * printing whatever its language. When none are in it, as for a Japanese code read under English,
 * every one is listed. A code read is already one language, being one set code.
 */
// eslint-disable-next-line react-refresh/only-export-components -- shared with the phone's last-scan card
export function choicesFor(row: ScanRow, language: Language | null): PickerOption[] {
  const own = row.options.filter((o) => o.cardId === row.cardId)
  const matched =
    row.via === 'code' && row.printingId !== null && row.flag !== 'pick-printing'
      ? own.filter((o) => o.setCode === row.setCode)
      : own
  const inLanguage = matched.some((o) => o.language === language)
  const shown = inLanguage
    ? matched.filter((o) => o.language === language || o.printingId === row.printingId)
    : matched
  const languages = new Set(shown.map((o) => o.language)).size > 1
  return shown.map((o) => {
    const tag = languageInfo(o.language).tag
    const label = `${o.setCode} · ${o.rarity}${languages ? ` · ${tag}` : ''}`
    return {
      key: String(o.printingId),
      label,
      search: `${o.setCode} ${o.rarity} ${o.setName} ${tag}`.toLowerCase(),
      badge: o.setCode,
      title: o.rarity,
      note: languages ? tag : undefined
    }
  })
}

export interface ScanRowActions {
  setPrinting(key: string, printingId: number): void
  setQuantity(key: string, q: number): void
  remove(key: string): void
}

const STEP =
  'flex size-8 items-center justify-center rounded-full text-white/85 hover:bg-white/[0.1] active:bg-white/[0.14] disabled:opacity-40'

/** One entry on the scan session list, as the phone's review shows it: a glass card. */
export const ScanRowItem = memo(function ScanRowItem({
  row,
  actions,
  language,
  highlighted = false,
  disabled = false
}: {
  row: ScanRow
  actions: ScanRowActions
  /** The scan language the printing dropdown is narrowed to; null lists every language. */
  language: Language | null
  highlighted?: boolean
  /** While the list is being added to the collection, rows can't change under it. */
  disabled?: boolean
}): React.JSX.Element {
  const choices = useMemo(() => choicesFor(row, language), [row, language])
  const price = priceOf(row)
  const { key } = row
  const { setPrinting } = actions
  const pick = useMemo(() => (v: string) => setPrinting(key, Number(v)), [key, setPrinting])
  return (
    <li
      className={cn(
        'flex gap-3 rounded-[20px] p-2.5 transition-colors duration-700',
        GLASS,
        row.flag && 'border-amber-400/45',
        highlighted && 'bg-emerald-400/10'
      )}
    >
      <CardArt imageId={row.imageId} size="small" alt="" className="w-12 shrink-0 self-start" />
      <div className="min-w-0 flex-1 text-[13px] leading-[18px]">
        <p className="truncate text-[15px] font-semibold leading-5">{row.name}</p>
        <p className="truncate text-muted-foreground">
          {row.setCode && <span className="font-mono text-xs">{row.setCode}</span>}
          {row.setCode && price != null && ' · '}
          {price != null && (
            <span aria-label={`Price of ${row.name}`} className="text-emerald-400 tabular-nums">
              {formatUsd(price)}
            </span>
          )}
        </p>
        <SearchPicker
          label={`Rarity for ${row.name}`}
          value={row.printingId === null ? null : String(row.printingId)}
          options={choices}
          onPick={pick}
          searchPlaceholder="Search code, rarity or set…"
          disabled={disabled}
          className="mt-1.5 h-8 max-w-full justify-start gap-1.5 rounded-full border-white/[0.12] bg-white/[0.08] px-2.5 text-xs shadow-none dark:bg-white/[0.08] dark:hover:bg-white/[0.14]"
          renderTrigger={(picked) => (
            <>
              <StarIcon aria-hidden className="size-3.5 shrink-0 text-white/60" />
              <span className={cn('truncate', !picked && 'text-muted-foreground')}>
                {picked ? picked.label : 'Choose a printing'}
              </span>
              <ChevronDownIcon aria-hidden className="size-3.5 shrink-0 opacity-60" />
            </>
          )}
        />
        {row.flag && (
          <p className="mt-1 flex items-center gap-1 text-xs text-amber-300">
            <TriangleAlertIcon aria-hidden className="size-3.5 shrink-0" />
            {FLAG_TEXT[row.flag]}
          </p>
        )}
        {row.error && <p className="mt-1 text-xs text-destructive">{row.error}</p>}
      </div>
      <div className="flex shrink-0 flex-col items-end justify-between gap-1">
        <button
          type="button"
          aria-label={`Remove ${row.name}`}
          disabled={disabled}
          onClick={() => actions.remove(row.key)}
          className="-mr-1 -mt-1 flex size-8 items-center justify-center rounded-full text-white/55 hover:bg-white/[0.08] hover:text-white/85 disabled:opacity-40"
        >
          <XIcon aria-hidden className="size-4" />
        </button>
        <div className={cn('flex items-center rounded-full', GLASS)}>
          <button
            type="button"
            aria-label={`One fewer ${row.name}`}
            disabled={disabled}
            onClick={() => actions.setQuantity(row.key, row.quantity - 1)}
            className={STEP}
          >
            <MinusIcon aria-hidden className="size-4" />
          </button>
          <span
            aria-label={`Quantity of ${row.name}`}
            className="w-5 text-center text-sm font-semibold tabular-nums"
          >
            {row.quantity}
          </span>
          <button
            type="button"
            aria-label={`One more ${row.name}`}
            disabled={disabled}
            onClick={() => actions.setQuantity(row.key, row.quantity + 1)}
            className={STEP}
          >
            <PlusIcon aria-hidden className="size-4" />
          </button>
        </div>
      </div>
    </li>
  )
})
