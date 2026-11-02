import { XIcon } from 'lucide-react'
import { HitPriceInput } from '@/features/scan/HitPriceInput'
import { useScanHub } from '@/features/scan/ScanHub'
import { plural } from '@/features/scan/scanText'
import { cn } from '@/lib/utils'

const BUTTON = 'h-12 w-full rounded-2xl text-[15px] font-semibold'

/**
 * Before a stream: the hit price, what to do first, and Start, or Carry on and Start new when a
 * stream's record survived (a crash, or the app closed mid-stream). `awake` false: the screen
 * can't be held on, so it says to set Auto-Lock instead.
 */
export function StreamStart({
  carryOn,
  awake,
  onStart,
  onCarryOn,
  onClose
}: {
  /** Cards on the surviving stream's record, or null when there is none to carry on. */
  carryOn: number | null
  awake: boolean | null
  onStart: () => void
  onCarryOn: () => void
  onClose: () => void
}): React.JSX.Element {
  const { settings, setSettings } = useScanHub()
  return (
    <div className="flex h-full flex-col overflow-auto pt-[calc(env(safe-area-inset-top)+0.5rem)] pb-[max(1.5rem,env(safe-area-inset-bottom))] pl-[calc(env(safe-area-inset-left)+1.5rem)] pr-[calc(env(safe-area-inset-right)+1.5rem)]">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="-ml-2 flex size-11 items-center justify-center rounded-full text-white active:bg-white/[0.08]"
      >
        <XIcon aria-hidden className="size-5" />
      </button>
      <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6">
        <h1 className="text-3xl font-bold tracking-tight">Stream</h1>
        <HitPriceInput
          value={settings.hitPrice}
          onCommit={(hitPrice) => setSettings({ hitPrice })}
          className="text-base text-foreground"
        />
        <ul className="list-disc space-y-1 pl-5 text-[15px] text-muted-foreground">
          <li>Turn on Do Not Disturb, because viewers can see notifications.</li>
          <li>Start your Discord share first.</li>
          {awake === false && (
            <li role="alert" className="text-amber-300">
              Set Auto-Lock to Never so the screen stays on.
            </li>
          )}
        </ul>
        <div className="space-y-2.5">
          {carryOn === null ? (
            <button type="button" onClick={onStart} className={cn(BUTTON, 'bg-white text-black')}>
              Start
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={onCarryOn}
                className={cn(BUTTON, 'bg-white text-black')}
              >
                Carry on ({plural(carryOn, 'card', 'cards')})
              </button>
              <button
                type="button"
                onClick={onStart}
                className={cn(BUTTON, 'border border-white/[0.13] bg-white/[0.07]')}
              >
                Start new
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
