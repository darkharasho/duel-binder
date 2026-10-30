import { useMemo, useRef, useState } from 'react'
import {
  ChevronDownIcon,
  MinusIcon,
  PlusIcon,
  StarIcon,
  TriangleAlertIcon,
  XIcon
} from 'lucide-react'
import { CardArt } from '@/components/CardArt'
import { useScanLanguage } from '@/features/scan/pickerOptions'
import { useScanHub } from '@/features/scan/ScanHub'
import { choicesFor, FLAG_TEXT, photoFor, setLabelFor } from '@/features/scan/ScanRowItem'
import { OptionLabel } from '@/features/scan/SearchPicker'
import type { ScanRow } from '@/features/scan/session'
import { ClearSessionDialog, useSessionCommit } from '@/features/scan/SessionList'
import { plural } from '@/features/scan/scanText'
import { formatUsd } from '@/lib/format'
import { cn } from '@/lib/utils'
import { PickerSheet } from './PickerSheet'
import { GLASS, listValue, priceOf } from '@/features/scan/scanLook'

/** A drag shorter than this is a tap. */
const TAP_PX = 8
/** How far the handle is dragged down before it closes the sheet. */
const SWITCH_PX = 48

const STEP =
  'flex size-10 items-center justify-center rounded-full text-white/85 active:bg-white/[0.12] disabled:opacity-40'

/** One scanned card: art, code and price, its printing, how many, and remove. */
function ReviewRow({ row, disabled }: { row: ScanRow; disabled: boolean }): React.JSX.Element {
  const { session } = useScanHub()
  const language = useScanLanguage()
  const choices = useMemo(() => choicesFor(row, language), [row, language])
  const price = priceOf(row)
  const picked = choices.find((c) => c.key === String(row.printingId))
  const where = setLabelFor(row)
  return (
    <li className={cn('flex gap-3 rounded-[20px] p-2.5', GLASS, row.flag && 'border-amber-400/45')}>
      <CardArt
        imageId={row.imageId}
        printingId={photoFor(row)}
        size="small"
        alt=""
        className="w-12 shrink-0 self-start"
      />
      <div className="min-w-0 flex-1 text-[13px] leading-[18px]">
        <p className="truncate text-[15px] font-semibold leading-5">{row.name}</p>
        <p className="truncate text-muted-foreground">
          {where && <span className={cn(row.setCode && 'font-mono text-xs')}>{where}</span>}
          {where && price != null && ' · '}
          {price != null && (
            <span aria-label={`Price of ${row.name}`} className="text-emerald-400 tabular-nums">
              {formatUsd(price)}
            </span>
          )}
        </p>
        <PickerSheet
          label={`Rarity for ${row.name}`}
          title="Printing"
          value={row.printingId === null ? null : String(row.printingId)}
          options={choices}
          onPick={(v) => session.setPrinting(row.key, Number(v))}
          searchPlaceholder="Search code, rarity or set…"
          disabled={disabled}
          className="mt-1.5 h-8 max-w-full gap-1.5 rounded-full border border-white/[0.12] bg-white/[0.08] px-2.5 text-xs active:bg-white/[0.14]"
        >
          <StarIcon aria-hidden className="size-3.5 shrink-0 text-white/60" />
          {picked ? (
            <OptionLabel option={picked} compact />
          ) : (
            <span className="truncate text-muted-foreground">Choose a printing</span>
          )}
          <ChevronDownIcon aria-hidden className="size-3.5 shrink-0 opacity-60" />
        </PickerSheet>
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
          onClick={() => session.remove(row.key)}
          className="-mr-1 -mt-1 flex size-10 items-center justify-center rounded-full text-white/55 active:bg-white/[0.08] disabled:opacity-40"
        >
          <XIcon aria-hidden className="size-4" />
        </button>
        <div className={cn('flex items-center rounded-full', GLASS)}>
          <button
            type="button"
            aria-label={`One fewer ${row.name}`}
            disabled={disabled}
            onClick={() => session.setQuantity(row.key, row.quantity - 1)}
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
            onClick={() => session.setQuantity(row.key, row.quantity + 1)}
            className={STEP}
          >
            <PlusIcon aria-hidden className="size-4" />
          </button>
        </div>
      </div>
    </li>
  )
}

/**
 * The full scanned list as a near full-height glass sheet over the blurred camera, closed by
 * tapping or dragging its handle down: each card with its printing and count, then Clear and Add.
 */
export function ReviewSheet({ onClose }: { onClose: () => void }): React.JSX.Element {
  const { session } = useScanHub()
  const { addable, commit } = useSessionCommit()
  const [clearing, setClearing] = useState(false)
  const [dy, setDy] = useState(0)
  const start = useRef<number | null>(null)
  const dragged = useRef(false)

  const { value, priced, unpriced } = listValue(session.rows)

  const onPointerDown = (e: React.PointerEvent): void => {
    start.current = e.clientY
    dragged.current = false
  }
  const onPointerMove = (e: React.PointerEvent): void => {
    if (start.current === null) return
    const d = e.clientY - start.current
    if (Math.abs(d) > TAP_PX) dragged.current = true
    setDy(d)
  }
  const onPointerUp = (): void => {
    if (start.current === null) return
    if (dragged.current && dy > SWITCH_PX) onClose()
    start.current = null
    setDy(0)
  }
  const onClick = (): void => {
    // A drag ends in a click too; only a tap closes.
    if (dragged.current) {
      dragged.current = false
      return
    }
    onClose()
  }

  return (
    <>
      <div
        aria-hidden
        className="absolute inset-0 z-20 bg-black/40 animate-in fade-in"
        onClick={onClose}
      />
      <section
        aria-labelledby="phone-review-title"
        style={dy > 0 ? { transform: `translateY(${dy}px)` } : undefined}
        className="absolute inset-x-0 bottom-0 top-[calc(env(safe-area-inset-top)+0.75rem)] z-30 flex flex-col rounded-t-[28px] border-t border-white/[0.1] bg-background/80 shadow-2xl backdrop-blur-2xl animate-in slide-in-from-bottom duration-200"
      >
        <button
          type="button"
          aria-label="Close review"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onClick={onClick}
          className="flex h-7 shrink-0 touch-none items-center justify-center"
        >
          <span aria-hidden className="h-1.5 w-10 rounded-full bg-white/25" />
        </button>
        <header className="flex shrink-0 items-end justify-between px-[18px] pb-3">
          <div>
            <p className="text-xs text-muted-foreground">This scan</p>
            <h2 id="phone-review-title" className="text-[22px] font-bold leading-7">
              Review
            </h2>
          </div>
          <div className="text-right">
            <p className="text-xs text-muted-foreground tabular-nums">
              {plural(session.total, 'card', 'cards')} ·{' '}
              {plural(session.rows.length, 'entry', 'entries')}
            </p>
            {priced > 0 && (
              <p
                aria-label="Value of the list"
                className="text-xl font-bold leading-7 tabular-nums"
              >
                {formatUsd(value)}
              </p>
            )}
            {priced > 0 && unpriced > 0 && (
              <p className="text-xs text-muted-foreground tabular-nums">
                {plural(unpriced, 'card', 'cards')} with no price
              </p>
            )}
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-auto overscroll-contain px-3">
          {session.rows.length === 0 ? (
            <p className="px-2 py-10 text-center text-sm text-muted-foreground">
              Cards you scan show up here.
            </p>
          ) : (
            <ul aria-label="This session" className="flex flex-col gap-2 pb-3">
              {session.rows.map((row) => (
                <ReviewRow key={row.key} row={row} disabled={session.committing} />
              ))}
            </ul>
          )}
        </div>
        <footer className="flex shrink-0 gap-2.5 border-t border-white/[0.06] px-3.5 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            disabled={session.rows.length === 0 || session.committing}
            onClick={() => setClearing(true)}
            className={cn(
              'h-[52px] rounded-full px-5 text-sm font-medium active:bg-white/[0.12] disabled:opacity-40',
              GLASS
            )}
          >
            Clear
          </button>
          <button
            type="button"
            disabled={addable === 0 || session.committing}
            onClick={() => void commit()}
            className="h-[52px] flex-1 rounded-full bg-white text-[15px] font-bold text-black shadow-lg active:bg-white/80 disabled:opacity-40"
          >
            Add {plural(addable, 'card', 'cards')}
          </button>
        </footer>
      </section>
      <ClearSessionDialog open={clearing} onOpenChange={setClearing} />
    </>
  )
}
