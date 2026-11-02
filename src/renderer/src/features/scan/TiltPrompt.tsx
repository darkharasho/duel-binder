import { Button } from '@/components/ui/button'

/**
 * "Tilt the card" over the camera while a card is held for its tilt; Skip when `onSkip` is
 * given. Glass like the scan window's pull bar, but it sits on the phone and the Scan page's own
 * camera, never the captured scan window, so its sizes are plain. Still: it draws nothing that
 * moves, so an idle camera costs no frames.
 */
export function TiltPrompt({
  name,
  onSkip
}: {
  name: string
  onSkip?: () => void
}): React.JSX.Element {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-12 flex justify-center px-3">
      {/* No live region of its own: the status bar already says "Tilt the card to read its rarity". */}
      <div className="flex max-w-full items-center gap-3 rounded-2xl bg-black/45 px-4 py-2 text-white backdrop-blur-xl">
        <div className="min-w-0">
          <p className="text-sm font-semibold">Tilt the card</p>
          <p className="truncate text-xs text-white/75">{name}</p>
        </div>
        {onSkip && (
          <Button
            variant="outline"
            size="xs"
            className="pointer-events-auto shrink-0"
            onClick={onSkip}
          >
            Skip
          </Button>
        )}
      </div>
    </div>
  )
}
