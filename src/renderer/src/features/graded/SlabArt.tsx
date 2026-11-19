import { AUTHENTIC, type GradedCopy } from '@shared/graded'
import { CardArt } from '@/components/CardArt'
import { scanFor } from '@/components/scanFor'
import { cn } from '@/lib/utils'

/** Each grading company's label accent; others get a neutral one. */
const ACCENTS: Record<string, string> = {
  PSA: '#c8102e',
  BGS: '#1f2937',
  CGC: '#0b5cad',
  SGC: '#111827',
  TAG: '#0f172a',
  ACE: '#b45309',
  ARS: '#7c3aed',
  PCG: '#047857',
  CCIC: '#be123c'
}

const slabAccent = (company: string): string => ACCENTS[company.toUpperCase()] ?? '#52525b'

/**
 * A slab drawn over the card's art: a clear case with the grader's label strip on top (card name,
 * set code, cert, and the grade large). CSS only; it scales with its width, so one component serves
 * the card panel's list, the Graded page's tiles and the panel's large view.
 */
export function SlabArt({
  slab,
  size = 'small',
  className
}: {
  slab: Pick<GradedCopy, 'company' | 'grade' | 'label' | 'cert' | 'imageId' | 'card'> &
    Parameters<typeof scanFor>[0]
  size?: 'small' | 'full'
  className?: string
}): React.JSX.Element {
  const accent = slabAccent(slab.company)
  const authentic = slab.grade === AUTHENTIC
  return (
    <div data-testid="slab" className={cn('@container', className)}>
      <div
        className={cn(
          'relative flex flex-col rounded-[6cqw] p-[4cqw]',
          // The acrylic case: a pale rim with a faint sheen over a dark inside.
          'border border-white/35 bg-gradient-to-br from-white/25 via-white/5 to-white/15 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08),0_6px_18px_rgba(0,0,0,0.35)]'
        )}
      >
        <div
          className="flex items-stretch gap-[2cqw] overflow-hidden rounded-[2.5cqw] bg-zinc-50 text-zinc-900"
          style={{ boxShadow: `inset 0 -1.2cqw 0 ${accent}` }}
        >
          <div className="min-w-0 flex-1 px-[3cqw] pb-[3cqw] pt-[2.5cqw] leading-tight">
            <div className="truncate text-[6.5cqw] font-semibold">{slab.card.name}</div>
            <div className="truncate text-[5cqw] text-zinc-600">
              {[slab.company, slab.label].filter(Boolean).join(' · ')}
            </div>
            {slab.cert && (
              <div className="truncate font-mono text-[4.5cqw] text-zinc-500">#{slab.cert}</div>
            )}
          </div>
          <div
            className="flex shrink-0 flex-col items-center justify-center px-[3cqw] pb-[1.2cqw] text-white"
            style={{ backgroundColor: accent }}
          >
            <span
              className={cn(
                'font-bold leading-none tabular-nums',
                authentic ? 'text-[6cqw]' : 'text-[13cqw]'
              )}
            >
              {authentic ? 'AUTH' : slab.grade}
            </span>
          </div>
        </div>
        <div className="mt-[4cqw] rounded-[2cqw] bg-black/40 p-[3cqw]">
          <CardArt
            imageId={slab.imageId}
            printingId={scanFor(slab)}
            size={size}
            alt=""
            className="w-full rounded-[2cqw]"
          />
        </div>
      </div>
    </div>
  )
}
