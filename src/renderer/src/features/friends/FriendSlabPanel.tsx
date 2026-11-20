import { ExternalLink } from 'lucide-react'
import { parseSubgrades, SUBGRADE_NAMES, type GradedCopy } from '@shared/graded'
import { printingReverseLook } from '@shared/reverseHolo'
import { slabReportUrl } from '@shared/scan/slabQr'
import { CardDetails } from '@/components/CardDetails'
import { CardDrawer } from '@/components/CardDrawer'
import { CopyNameButton } from '@/components/CopyNameButton'
import { LanguageTag } from '@/components/LanguageTag'
import { PanelCardArt } from '@/components/PanelCardArt'
import { SlabPanelPrice } from '@/components/PanelPrice'
import { scanFor } from '@/components/scanFor'
import { SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { SlabArt } from '../graded/SlabArt'

/** A friend's slab, read-only: in its case, its grade's price and cert. Rendered inside a CardSheet. */
export function FriendSlabPanel({ slab }: { slab: GradedCopy }): React.JSX.Element {
  const card = slab.card
  const typeLine = [card.type, card.attribute, card.race].filter(Boolean).join(' · ')
  const report = slabReportUrl(slab.company, slab.cert)
  const subs = parseSubgrades(slab.subgrades)
  return (
    <CardDrawer
      header={
        <SheetHeader>
          <div className="flex items-center gap-1">
            <SheetTitle>{card.name}</SheetTitle>
            <CopyNameButton name={card.name} />
          </div>
          <SheetDescription>{typeLine}</SheetDescription>
        </SheetHeader>
      }
      art={
        <PanelCardArt
          imageId={slab.imageId}
          printingId={scanFor(slab)}
          alt={card.name}
          slab={<SlabArt slab={slab} size="full" />}
          reverse={printingReverseLook(slab.printing, card)}
        />
      }
    >
      <div className="space-y-1">
        <p className="flex items-center gap-1.5 font-mono text-[13px] text-muted-foreground">
          {slab.printing.setCode} · {slab.printing.setRarity}
          <LanguageTag language={slab.printing.language} />
        </p>
        <SlabPanelPrice slab={slab} whose="Their" />
      </div>

      <section aria-label="Slab" className="space-y-1 text-sm">
        {slab.cert && (
          <p>
            <span className="text-muted-foreground">Cert</span>{' '}
            <span className="font-mono">#{slab.cert}</span>
          </p>
        )}
        {subs && (
          <p className="text-muted-foreground">
            {SUBGRADE_NAMES.map((n, i) => `${n} ${subs[i]}`).join(' · ')}
          </p>
        )}
        {report && (
          <a
            href={report}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            View {slab.company} report
            <ExternalLink aria-hidden className="size-3" />
          </a>
        )}
      </section>

      <CardDetails card={card} printing={slab.printing} />
    </CardDrawer>
  )
}
