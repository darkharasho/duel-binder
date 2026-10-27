import { useRef, useState } from 'react'
import { ChevronUpIcon, SettingsIcon } from 'lucide-react'
import type { ScanEngine } from '@/features/scan/engine'
import { useScanPickers } from '@/features/scan/pickerOptions'
import { useScanHub } from '@/features/scan/ScanHub'
import { SearchPicker } from '@/features/scan/SearchPicker'
import { SessionList } from '@/features/scan/SessionList'
import { PhoneCamera } from './PhoneCamera'
import { StatusLine } from './StatusLine'

/** A drag shorter than this is a tap. */
const TAP_PX = 8
/** How far a drag goes before it opens or closes the sheet. */
const SWITCH_PX = 48

/**
 * The scanned list in a bottom sheet: collapsed to a "N scanned · Review" bar, and dragged or
 * tapped up to most of the screen.
 */
function ReviewSheet(): React.JSX.Element {
  const { session } = useScanHub()
  const [open, setOpen] = useState(false)
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
    if (dragged.current) {
      if (!open && dy < -SWITCH_PX) setOpen(true)
      else if (open && dy > SWITCH_PX) setOpen(false)
    }
    start.current = null
    setDy(0)
  }
  const onClick = (): void => {
    // A drag ends in a click too; only a tap toggles.
    if (dragged.current) {
      dragged.current = false
      return
    }
    setOpen((o) => !o)
  }
  const handle = {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel: onPointerUp,
    onClick
  }

  const label = `${session.total} scanned · Review`
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        {...handle}
        style={!open && dy < 0 ? { transform: `translateY(${Math.max(dy, -80)}px)` } : undefined}
        className="mx-3 mb-3 flex h-14 shrink-0 touch-none items-center justify-between rounded-2xl border border-white/[0.08] bg-card px-5 text-base font-medium shadow-lg active:bg-white/[0.06]"
      >
        <span className="tabular-nums">{label}</span>
        <ChevronUpIcon aria-hidden className="size-5 text-muted-foreground" />
      </button>

      {open && (
        <>
          <div
            aria-hidden
            className="absolute inset-0 z-20 bg-black/50 animate-in fade-in"
            onClick={() => setOpen(false)}
          />
          <div
            style={dy > 0 ? { transform: `translateY(${dy}px)` } : undefined}
            className="absolute inset-x-0 bottom-0 z-30 flex h-[85%] flex-col rounded-t-3xl border-t border-white/[0.08] bg-background shadow-2xl animate-in slide-in-from-bottom duration-200"
          >
            <button
              type="button"
              aria-label="Close review"
              {...handle}
              className="flex h-8 shrink-0 touch-none items-center justify-center"
            >
              <span aria-hidden className="h-1.5 w-10 rounded-full bg-white/25" />
            </button>
            <SessionList className="mx-0 min-h-0 flex-1 rounded-none border-x-0 border-b-0" />
          </div>
        </>
      )}
    </>
  )
}

/**
 * The phone's Scan tab: the camera on top, the status line under it, the set and rarity pickers,
 * and the scanned list in a bottom sheet. The gear opens Settings.
 */
export function ScannerScreen({
  engineFactory,
  onOpenSettings
}: {
  engineFactory?: () => ScanEngine
  onOpenSettings: () => void
}): React.JSX.Element {
  const pickers = useScanPickers()
  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden">
      <PhoneCamera engineFactory={engineFactory}>
        <button
          type="button"
          aria-label="Settings"
          onClick={onOpenSettings}
          className="absolute left-3 top-3 flex size-11 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-md"
        >
          <SettingsIcon aria-hidden className="size-5" />
        </button>
      </PhoneCamera>
      <StatusLine className="shrink-0" />
      <div className="flex shrink-0 gap-2 px-3 pb-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span aria-hidden className="px-1 text-[11px] text-muted-foreground">
            Set
          </span>
          <SearchPicker
            label="Set"
            value={pickers.set.value}
            options={pickers.set.options}
            onPick={pickers.set.onPick}
            searchPlaceholder="Search sets…"
            className="h-11 w-full"
          />
        </div>
        <div className="flex w-36 shrink-0 flex-col gap-1">
          <span aria-hidden className="px-1 text-[11px] text-muted-foreground">
            New scans as
          </span>
          <SearchPicker
            label="New scans as"
            value={pickers.rarity.value}
            options={pickers.rarity.options}
            onPick={pickers.rarity.onPick}
            searchPlaceholder="Search rarities…"
            className="h-11 w-full"
          />
        </div>
      </div>
      <ReviewSheet />
    </div>
  )
}
