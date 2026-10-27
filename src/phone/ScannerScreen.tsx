import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowRightIcon,
  CopyIcon,
  LanguagesIcon,
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
import type { PickerOption } from '@/features/scan/SearchPicker'
import type { ScanRow } from '@/features/scan/session'
import { api, queryKeys } from '@/lib/api'
import { formatUsd } from '@/lib/format'
import { cn } from '@/lib/utils'
import { FoundBurst } from './FoundBurst'
import { PhoneCamera } from './PhoneCamera'
import { PickerSheet } from './PickerSheet'
import { ReviewSheet } from './ReviewSheet'
import { GLASS, priceOf } from './scanLook'

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
function LastScan({ row, burst }: { row: ScanRow; burst: number }): React.JSX.Element {
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
    <section
      aria-label="Last scan"
      // Keyed by the burst, so each new scan replays the bump and the art dropping in.
      key={burst}
      className={cn(CARD, burst > 0 && 'motion-safe:animate-[scan-bump_450ms_350ms_both]')}
    >
      <CardArt
        imageId={row.imageId}
        size="small"
        alt=""
        className={cn(
          'w-14 shrink-0 self-start',
          burst > 0 && 'motion-safe:animate-[scan-drop_500ms_ease-in_both]'
        )}
      />
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

/** A picker as a pill: its icon, its name, and what it's set to; it opens a picker sheet. */
function Chip({
  label,
  name,
  title,
  icon: Icon,
  picker,
  shown,
  searchPlaceholder
}: {
  label: string
  name: string
  title: string
  icon: typeof StarIcon
  picker: PickerProps
  shown: (picked: PickerOption | undefined) => string
  searchPlaceholder: string
}): React.JSX.Element {
  const picked = picker.options.find((o) => o.key === picker.value)
  return (
    <PickerSheet
      label={label}
      title={title}
      value={picker.value}
      options={picker.options}
      onPick={picker.onPick}
      searchPlaceholder={searchPlaceholder}
      className={cn(
        'h-[38px] max-w-[60vw] shrink-0 gap-1.5 rounded-full px-3.5 text-sm font-medium active:bg-white/[0.12]',
        GLASS
      )}
    >
      <Icon aria-hidden className="size-4 shrink-0 text-white/55" />
      <span className="sr-only">{name} </span>
      <span className="truncate">{shown(picked)}</span>
    </PickerSheet>
  )
}

const ROUND = 'flex size-11 items-center justify-center rounded-full backdrop-blur-md'

/**
 * The phone's scanner, full screen over the camera's own blurred picture: the camera on top, the
 * last card scanned under it, the language, set and rarity chips, and the session's count and
 * value with a button to the full list. The × goes back to Home; the gear opens Settings.
 */
export function ScannerScreen({
  engineFactory,
  onClose,
  onOpenSettings
}: {
  engineFactory?: () => ScanEngine
  onClose: () => void
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

  // A new scan is the newest row's time moving on (a repeat scan moves it too); removing a row
  // or changing a printing doesn't. Counted while rendering, so the first one shows at once.
  const stamp = last?.addedAt ?? 0
  const [seen, setSeen] = useState(stamp)
  const [burst, setBurst] = useState(0)
  if (stamp !== seen) {
    setSeen(stamp)
    if (stamp > seen) setBurst(burst + 1)
  }
  useEffect(() => {
    // A short buzz where the phone allows it (Android; iPhone browsers have no vibration).
    if (burst > 0) navigator.vibrate?.(30)
  }, [burst])

  return (
    <div className="relative isolate flex h-full min-h-0 w-full flex-col overflow-hidden pt-[env(safe-area-inset-top)]">
      <PhoneCamera engineFactory={engineFactory} className="px-6 pt-3">
        <button
          type="button"
          aria-label="Close scanner"
          onClick={onClose}
          className={cn(ROUND, 'absolute left-2 top-2 bg-black/45 text-white')}
        >
          <XIcon aria-hidden className="size-5" />
        </button>
        <button
          type="button"
          aria-label="Settings"
          onClick={onOpenSettings}
          className={cn(ROUND, 'absolute right-2 top-2 bg-black/45 text-white')}
        >
          <SettingsIcon aria-hidden className="size-5" />
        </button>
        {burst > 0 && last && <FoundBurst key={burst} name={last.name} price={priceOf(last)} />}
      </PhoneCamera>
      <div className="shrink-0 px-3.5 pt-3">
        {last ? (
          <LastScan row={last} burst={burst} />
        ) : (
          <section
            aria-label="Last scan"
            className={cn(CARD, 'items-center justify-center text-sm text-muted-foreground')}
          >
            Scanned cards show up here
          </section>
        )}
      </div>
      <div className="flex min-w-0 shrink-0 gap-2 overflow-x-auto px-3.5 pt-2.5 [scrollbar-width:none]">
        <Chip
          label="Language"
          name="Language"
          title="Language"
          icon={LanguagesIcon}
          picker={pickers.language}
          shown={(p) => (!p || p.key === 'all' ? 'All' : p.label)}
          searchPlaceholder="Search languages…"
        />
        <Chip
          label="Set"
          name="Set"
          title="Sets"
          icon={LayersIcon}
          picker={pickers.set}
          shown={(p) => (pickers.set.value === 'any' || !p ? 'Any set' : p.label)}
          searchPlaceholder="Search sets…"
        />
        <Chip
          label="New scans as"
          name="Rarity"
          title="New scans as"
          icon={StarIcon}
          picker={pickers.rarity}
          shown={(p) => (!p || p.key === 'auto' ? 'Auto rarity' : p.label)}
          searchPlaceholder="Search rarities…"
        />
      </div>
      <div className="flex shrink-0 pb-[max(0.75rem,env(safe-area-inset-bottom))] items-center justify-between px-4 pt-3">
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
