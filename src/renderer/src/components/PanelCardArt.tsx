import { CardArt } from '@/components/CardArt'
import { TiltCard } from '@/components/TiltCard'
import { SheetPortal } from '@/components/ui/sheet'

interface PanelCardArtProps {
  imageId: number
  printingId?: number | null
  alt: string
}

/**
 * A side panel's card: floated large over the blurred page to the panel's left, or kept small
 * at the top of the panel when the window is too narrow for that.
 */
export function PanelCardArt({ imageId, printingId, alt }: PanelCardArtProps): React.JSX.Element {
  return (
    <>
      <TiltCard className="mx-auto w-48 min-[900px]:hidden">
        <CardArt
          imageId={imageId}
          printingId={printingId}
          size="full"
          alt={alt}
          className="w-full"
        />
      </TiltCard>
      {/* Portalled out of the sliding panel so it isn't moved by the panel's transform. */}
      <SheetPortal>
        <div className="pointer-events-none fixed inset-y-0 left-0 right-[420px] z-50 hidden items-center justify-center p-12 duration-500 animate-in fade-in-0 zoom-in-90 min-[900px]:flex">
          <TiltCard
            maxTilt={10}
            glareClassName="rounded-[14px]"
            className="pointer-events-auto w-[min(26rem,calc((100vh-6rem)*421/614))] [perspective:1400px]"
          >
            <CardArt
              imageId={imageId}
              printingId={printingId}
              size="full"
              alt=""
              className="w-full rounded-[14px] shadow-[0_30px_80px_rgb(0_0_0/0.65)]"
            />
          </TiltCard>
        </div>
      </SheetPortal>
    </>
  )
}
