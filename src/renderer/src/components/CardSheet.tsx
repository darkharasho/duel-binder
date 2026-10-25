import { Sheet, SheetContent } from '@/components/ui/sheet'

/**
 * The right-hand sheet a card panel renders into. Pages keep one mounted around whichever panel
 * is open, so stepping between cards swaps the panel without the sheet sliding out and back.
 */
export function CardSheet({
  onClose,
  children
}: {
  onClose: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-[420px] overflow-y-auto sm:max-w-[420px]">{children}</SheetContent>
    </Sheet>
  )
}
