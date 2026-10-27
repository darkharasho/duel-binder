import { ChevronLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { isPhone } from '@/lib/platform'

/**
 * The right-hand sheet a card panel renders into. Pages keep one mounted around whichever panel
 * is open, so stepping between cards swaps the panel without the sheet sliding out and back.
 * On the phone it fills the screen, with a back button in place of the close button.
 */
export function CardSheet({
  onClose,
  children
}: {
  onClose: () => void
  children: React.ReactNode
}): React.JSX.Element {
  const phone = isPhone()
  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      {phone ? (
        <SheetContent
          data-layout="full-screen"
          showCloseButton={false}
          className="inset-0 h-dvh w-full max-w-none gap-0 overflow-y-auto overscroll-contain border-0 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] sm:max-w-none"
        >
          <div className="sticky top-0 z-10 bg-background/80 px-2 py-1 backdrop-blur-xl">
            <Button variant="ghost" onClick={onClose}>
              <ChevronLeft />
              Back
            </Button>
          </div>
          {children}
        </SheetContent>
      ) : (
        <SheetContent className="w-[420px] overflow-y-auto sm:max-w-[420px]">
          {children}
        </SheetContent>
      )}
    </Sheet>
  )
}
