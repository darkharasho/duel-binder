import { useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowRightIcon,
  CopyIcon,
  LayersIcon,
  SettingsIcon,
  ShuffleIcon,
  StarIcon,
  XIcon
} from 'lucide-react'
import { CardArt } from '@/components/CardArt'
import type { ScanEngine } from '@/features/scan/engine'
import { useScanPickers, type PickerProps } from '@/features/scan/pickerOptions'
import { choicesFor, FLAG_TEXT } from '@/features/scan/ScanRowItem'
import { useScanHub } from '@/features/scan/ScanHub'
import { SearchPicker, type PickerOption } from '@/features/scan/SearchPicker'
import type { ScanRow } from '@/features/scan/session'
import { SessionList } from '@/features/scan/SessionList'
import { api, queryKeys } from '@/lib/api'
import { formatUsd } from '@/lib/format'
import { cn } from '@/lib/utils'
import { PhoneCamera } from './PhoneCamera'
import { StatusLine } from './StatusLine'

/** A drag shorter than this is a tap. */
const TAP_PX = 8
/** How far the handle is dragged down before it closes the sheet. */
const SWITCH_PX = 48

const GLASS = 'border border-white/[0.13] bg-white/[0.07] backdrop-blur-xl'

/** Rows saved before prices existed have no `price` key at all. */
const priceOf = (row: ScanRow): number | null | undefined =>
  row.options.find((o) => o.printingId === row.printingId)?.price

/** The full scanned list in a bottom sheet, closed by tapping or dragging its handle down. */
function ReviewSheet({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [dy, setDy] = useState(0)
  const start = useRef<number | null>(null)
  const dragged = useRef(false)

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
        className="absolute inset-0 z-20 bg-black/50 animate-in fade-in"
        onClick={onClose}
      />
      {/* pb-8 keeps the list clear of the Scan button rising out of the tabs. */}
      <div
        style={dy > 0 ? { transform: `translateY(${dy}px)` } : undefined}
        className="absolute inset-x-0 bottom-0 z-30 flex h-[85%] flex-col rounded-t-3xl pb-8 border-t border-white/[0.08] bg-background shadow-2xl animate-in slide-in-from-bottom duration-200"
      >
        <button
          type="button"
          aria-label="Close review"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onClick={onClick}
          className="flex h-8 shrink-0 touch-none items-center justify-center"
        >
          <span aria-hidden className="h-1.5 w-10 rounded-full bg-white/25" />
        </button>
        <SessionList className="mx-0 min-h-0 flex-1 rounded-none border-x-0 border-b-0" />
      </div>
    </>
  )
}

/** Copies of the row's printing already in the collection, any condition; null while loading. */
function useOwned(row: ScanRow): number | null {
  const entries = useQuery({
    queryKey: queryKeys.forCard(row.cardId),
    queryFn: () => api.collection.forCard(row.cardId)
  })
  if (!entries.data) return null
  return entries.data
    .filter((e) => e.printing.id === row.printingId)
    .reduce((n, e) => n + e.quantity, 0)
}

function ownedText(owned: number, quantity: number): string {
  const own = owned > 0 ? `Own ${owned}` : 'Not owned'
  return owned > 0 && quantity <= 1 ? own : `${own} · ×${quantity} this scan`
}

const CARD = cn('flex min-h-28 shrink-0 gap-3 rounded-3xl p-2.5', GLASS)

/** The newest row of the session, with its printing cycled or the row removed in place. */
function LastScan({ row }: { row: ScanRow }): React.JSX.Element {
  const { session } = useScanHub()
  const owned = useOwned(row)
  const choices = useMemo(() => choicesFor(row), [row])
  const at = choices.findIndex((c) => c.key === String(row.printingId))
  const printing = row.options.find((o) => o.printingId === row.printingId)
  const price = priceOf(row)
  const sub = [row.setCode, printing?.setName].filter(Boolean).join(' · ')

  const cycle = (): void => {
    const next = choices[(at + 1) % choices.length]
    session.setPrinting(row.key, Number(next.key))
  }

  return (
    <section aria-label="Last scan" className={CARD}>
      <CardArt imageId={row.imageId} size="small" alt="" className="w-14 shrink-0 self-start" />
      <div className="min-w-0 flex-1 text-[13px] leading-[18px]">
        <p className="truncate text-base font-semibold leading-5">{row.name}</p>
        {sub && <p className="truncate text-muted-foreground">{sub}</p>}
        {price != null && (
          <p aria-label={`Price of ${row.name}`} className="text-emerald-400 tabular-nums">
            {formatUsd(price)}
          </p>
        )}
        {row.rarity && (
          <p className="mt-0.5 flex items-center gap-1 text-white/75">
            <StarIcon aria-hidden className="size-3.5 shrink-0" />
            <span className="truncate">{row.rarity}</span>
          </p>
        )}
        <p className="flex items-center gap-1 text-white/75">
          <CopyIcon aria-hidden className="size-3.5 shrink-0" />
          <span className="truncate">
            {owned === null ? `×${row.quantity} this scan` : ownedText(owned, row.quantity)}
          </span>
        </p>
        {row.flag && <p className="text-amber-300">{FLAG_TEXT[row.flag]}</p>}
      </div>
      <div className="flex shrink-0 items-center">
        {choices.length > 1 && (
          <button
            type="button"
            aria-label={`Next printing of ${row.name}`}
            disabled={session.committing}
            onClick={cycle}
            className="flex h-12 w-11 flex-col items-center justify-center gap-0.5 rounded-xl text-[11px] text-white/75 active:bg-white/[0.08] disabled:opacity-50"
          >
            <ShuffleIcon aria-hidden className="size-5" />
            <span className="tabular-nums">
              {at < 0 ? '–' : at + 1}/{choices.length}
            </span>
          </button>
        )}
        <button
          type="button"
          aria-label={`Remove ${row.name}`}
          disabled={session.committing}
          onClick={() => session.remove(row.key)}
          className="flex h-12 w-11 items-center justify-center rounded-xl text-white/75 active:bg-white/[0.08] disabled:opacity-50"
        >
          <XIcon aria-hidden className="size-5" />
        </button>
      </div>
    </section>
  )
}

/** A picker as a pill: its icon, its name, and what it's set to. */
function Chip({
  label,
  name,
  icon: Icon,
  picker,
  shown,
  searchPlaceholder
}: {
  label: string
  name: string
  icon: typeof StarIcon
  picker: PickerProps
  shown: (picked: PickerOption | undefined) => string
  searchPlaceholder: string
}): React.JSX.Element {
  return (
    <SearchPicker
      label={label}
      value={picker.value}
      options={picker.options}
      onPick={picker.onPick}
      searchPlaceholder={searchPlaceholder}
      className={cn(
        'h-[38px] max-w-[70%] shrink-0 justify-start gap-1.5 rounded-full px-3.5 text-sm font-medium shadow-none dark:bg-white/[0.07] dark:hover:bg-white/[0.12]',
        GLASS
      )}
      renderTrigger={(picked) => (
        <>
          <Icon aria-hidden className="size-4 shrink-0" />
          <span className="shrink-0">{name}</span>
          <span className="truncate font-normal text-white/55">{shown(picked)}</span>
        </>
      )}
    />
  )
}

/**
 * The phone's Scan tab: the camera on top, the last card scanned under it, the set and rarity
 * chips, and the session's count and value with a button to the full list. The gear opens
 * Settings.
 */
export function ScannerScreen({
  engineFactory,
  onOpenSettings
}: {
  engineFactory?: () => ScanEngine
  onOpenSettings: () => void
}): React.JSX.Element {
  const { session } = useScanHub()
  const pickers = useScanPickers()
  const [reviewing, setReviewing] = useState(false)

  const last = session.rows.reduce<ScanRow | null>(
    (a, r) => (a === null || r.addedAt > a.addedAt ? r : a),
    null
  )
  const priced = session.rows.filter((r) => priceOf(r) != null)
  const value = priced.reduce((n, r) => n + priceOf(r)! * r.quantity, 0)
  const total = session.total

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden">
      <PhoneCamera engineFactory={engineFactory} className="px-6 pt-3">
        <button
          type="button"
          aria-label="Settings"
          onClick={onOpenSettings}
          className="absolute left-2 top-2 flex size-11 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-md"
        >
          <SettingsIcon aria-hidden className="size-5" />
        </button>
      </PhoneCamera>
      <StatusLine className="shrink-0" />
      <div className="shrink-0 px-3.5 pt-3">
        {last ? (
          <LastScan row={last} />
        ) : (
          <section
            aria-label="Last scan"
            className={cn(CARD, 'items-center justify-center text-sm text-muted-foreground')}
          >
            Scanned cards show up here
          </section>
        )}
      </div>
      <div className="flex shrink-0 gap-2 overflow-x-auto px-3.5 pt-2.5">
        <Chip
          label="Set"
          name="Set"
          icon={LayersIcon}
          picker={pickers.set}
          shown={(p) => (pickers.set.value === 'any' || !p ? 'Any' : p.label)}
          searchPlaceholder="Search sets…"
        />
        <Chip
          label="New scans as"
          name="Rarity"
          icon={StarIcon}
          picker={pickers.rarity}
          shown={(p) => p?.label ?? 'Auto'}
          searchPlaceholder="Search rarities…"
        />
      </div>
      {/* mb-8 keeps the footer clear of the Scan button rising out of the tabs. */}
      <div className="mb-8 flex shrink-0 items-center justify-between px-4 pt-3">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground tabular-nums">
            {total} {total === 1 ? 'card' : 'cards'}
          </p>
          {priced.length > 0 && (
            <p
              aria-label="Value of this scan"
              className="text-[21px] font-bold leading-7 tabular-nums"
            >
              {formatUsd(value)}
            </p>
          )}
        </div>
        <button
          type="button"
          aria-label={`Review ${total} scanned`}
          aria-expanded={reviewing}
          onClick={() => setReviewing(true)}
          className="flex size-[50px] items-center justify-center rounded-full bg-white text-black shadow-lg active:bg-white/80"
        >
          <ArrowRightIcon aria-hidden className="size-5" />
        </button>
      </div>
      {reviewing && <ReviewSheet onClose={() => setReviewing(false)} />}
    </div>
  )
}
