import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { CardArt } from '@/components/CardArt'
import { FoilLayer } from '@/components/FoilLayer'
import { usePanelNavKeys, useSwipeNav, type PanelNav } from '@/components/panelNav'
import { TiltCard } from '@/components/TiltCard'
import { chooseArtWindow, NO_FOIL, type CardFoil } from '@shared/foil'
import { cssAspect } from '@shared/games'
import { Button } from '@/components/ui/button'
import { SheetPortal } from '@/components/ui/sheet'
import { queryKeys } from '@/lib/api'
import { detectArtWindow } from '@/lib/pageArtWindow'
import { useCardAspect } from '@/lib/game'
import { isPhone } from '@/lib/platform'
import { cn } from '@/lib/utils'

interface PanelCardArtProps {
  imageId: number
  printingId?: number | null
  alt: string
  /** Previous/next card arrows (and arrow keys; swipes on the phone); none when omitted. */
  nav?: PanelNav
  /** The shown printing's foil (`cardFoil`); no foil, shine or glare when omitted. */
  foil?: CardFoil
}

function NavArrow({
  dir,
  step,
  large,
  srOnly
}: {
  dir: 'prev' | 'next'
  step: (() => void) | undefined
  large?: boolean
  /** Kept for screen readers (whose swipes never reach the page) but not shown. */
  srOnly?: boolean
}): React.JSX.Element {
  const Icon = dir === 'prev' ? ChevronLeft : ChevronRight
  return (
    <Button
      variant="outline"
      size={large ? 'icon-lg' : 'icon-sm'}
      aria-label={dir === 'prev' ? 'Previous card' : 'Next card'}
      disabled={!step}
      onClick={step}
      className={cn(
        'pointer-events-auto shrink-0 rounded-full',
        large && '[&_svg]:size-5',
        srOnly && 'sr-only'
      )}
    >
      <Icon />
    </Button>
  )
}

/**
 * A side panel's card: floated large over the blurred page to the panel's left, or kept small
 * at the top of the panel when the window is too narrow for that.
 */
export function PanelCardArt({
  imageId,
  printingId,
  alt,
  nav,
  foil = NO_FOIL
}: PanelCardArtProps): React.JSX.Element {
  usePanelNavKeys(nav)
  useSwipeNav(nav)
  const aspect = useCardAspect(imageId)
  // The phone steps by swiping across the card (CardSheet), so its arrows are one pair for
  // screen readers only, outside both layouts so they exist at every width; the layouts
  // show arrows on desktop alone.
  const phone = isPhone()
  const arrows = phone ? undefined : nav
  const found = useQuery({
    queryKey: queryKeys.artWindow(imageId, printingId ?? null, foil.roundedLeft),
    queryFn: () => detectArtWindow({ imageId, printingId: printingId ?? null }, foil.roundedLeft),
    enabled: foil.detect,
    // An image's box never changes: found once a session.
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false
  })
  const artWindow = chooseArtWindow(found.data, foil.window)
  // Held back until the box is known, so a mask never jumps into place.
  const foilKind = foil.detect && found.isPending ? 'none' : foil.kind
  const shiny = foilKind !== 'none'
  // The large card's width is capped by the window's height at the card's own aspect.
  const aspectVar = { '--card-aspect': `calc(${cssAspect(aspect)})` } as React.CSSProperties
  return (
    <>
      {phone && nav && (
        <>
          <NavArrow dir="prev" step={nav.prev} srOnly />
          <NavArrow dir="next" step={nav.next} srOnly />
        </>
      )}
      <div className="flex items-center justify-center gap-3 min-[900px]:hidden">
        {arrows && <NavArrow dir="prev" step={arrows.prev} />}
        <TiltCard className="w-48" glare={shiny}>
          <CardArt
            imageId={imageId}
            printingId={printingId}
            size="full"
            priority
            alt={alt}
            className="w-full"
          />
          <FoilLayer
            kind={foilKind}
            finish={foil.finish}
            texture={foil.texture}
            window={artWindow}
            aspect={aspect}
            className="rounded-[6px]"
            device={phone}
          />
        </TiltCard>
        {arrows && <NavArrow dir="next" step={arrows.next} />}
      </div>
      {/* Portalled out of the sliding panel so it isn't moved by the panel's transform. */}
      <SheetPortal>
        <div
          style={aspectVar}
          className="pointer-events-none fixed inset-y-0 left-0 right-[420px] z-50 hidden items-center justify-center gap-6 p-12 duration-500 animate-in fade-in-0 zoom-in-90 min-[900px]:flex"
        >
          {arrows && <NavArrow dir="prev" step={arrows.prev} large />}
          <TiltCard
            maxTilt={10}
            glare={shiny}
            glareClassName="rounded-[14px]"
            className="pointer-events-auto w-[min(26rem,calc((100vh-6rem)*var(--card-aspect)))] min-w-0 [perspective:1400px]"
          >
            <CardArt
              imageId={imageId}
              printingId={printingId}
              size="full"
            priority
              alt=""
              className="w-full rounded-[14px] shadow-[0_30px_80px_rgb(0_0_0/0.65)]"
            />
            <FoilLayer
              kind={foilKind}
              finish={foil.finish}
              texture={foil.texture}
              window={artWindow}
              aspect={aspect}
              className="rounded-[14px]"
            />
          </TiltCard>
          {arrows && <NavArrow dir="next" step={arrows.next} large />}
        </div>
      </SheetPortal>
    </>
  )
}
