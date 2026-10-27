import { useQuery } from '@tanstack/react-query'
import { api, queryKeys } from '@/lib/api'
import { rarityColor, rarityTextColor } from '@/lib/rarityColors'
import { cn } from '@/lib/utils'
import { baseOf, revealTier } from '../../../../shared/rip/rarity'
import type { RipCard } from '../../../../shared/rip/types'
import {
  attributeColor,
  isSpellOrTrap,
  levelLabel,
  splitDesc,
  statBoxes,
  typeLine
} from './cardFacts'

export function RarityBadge({
  rarity,
  className
}: {
  rarity: string
  className?: string
}): React.JSX.Element {
  return (
    <span
      style={{
        backgroundColor: rarityColor(baseOf(rarity)),
        color: rarityTextColor(baseOf(rarity))
      }}
      className={cn(
        'rounded-full px-2.5 py-0.5 text-xs leading-none font-semibold shadow-sm',
        className
      )}
    >
      {rarity}
    </span>
  )
}

function AttributeChip({ attribute }: { attribute: string }): React.JSX.Element {
  return (
    <span
      data-testid="rip-attribute"
      className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.06] px-2 py-0.5 text-[11px] font-semibold tracking-wide text-white/85"
    >
      <span
        aria-hidden
        className="size-2 rounded-full"
        style={{
          backgroundColor: attributeColor(attribute),
          boxShadow: `0 0 6px ${attributeColor(attribute)}`
        }}
      />
      {attribute.toUpperCase()}
    </span>
  )
}

/**
 * What the front card is: its rarity, name and code at once, then (once its details load) its
 * type line, ATK/DEF and text. Fills the height it's given; the text scrolls inside.
 */
export function CardInfo({ card }: { card: RipCard }): React.JSX.Element {
  const q = useQuery({
    queryKey: queryKeys.card(card.cardId),
    queryFn: () => api.cards.get(card.cardId)
  })
  const row = q.data?.card ?? null
  const level = row ? levelLabel(row) : null
  const stats = row ? statBoxes(row) : []
  const desc = row ? splitDesc(row) : null
  return (
    <div className="flex max-h-full min-h-0 w-full flex-col items-start gap-2.5">
      <RarityBadge
        rarity={card.rarity}
        className={cn(revealTier(card.rarity) === 'huge' && 'px-3 py-1 text-sm')}
      />
      <div className="flex flex-col gap-0.5">
        <span className="text-2xl leading-tight font-bold text-white">{card.name}</span>
        <span className="text-xs text-white/55">{card.setCode}</span>
      </div>
      {q.isPending && (
        <div data-testid="rip-info-loading" aria-hidden className="flex w-full flex-col gap-2 pt-1">
          <div className="h-3 w-2/3 rounded bg-white/[0.07]" />
          <div className="h-3 w-full rounded bg-white/[0.05]" />
          <div className="h-3 w-5/6 rounded bg-white/[0.05]" />
        </div>
      )}
      {row && (
        <>
          <div
            data-testid="rip-type-line"
            className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[13px] text-white/75"
          >
            {row.attribute && !isSpellOrTrap(row) && <AttributeChip attribute={row.attribute} />}
            <span>{typeLine(row)}</span>
            {level && <span className="text-amber-200/90">{level}</span>}
          </div>
          {stats.length > 0 && (
            <div className="flex gap-2">
              {stats.map((s) => (
                <div
                  key={s.label}
                  data-testid="rip-stat"
                  className="min-w-[78px] rounded-md border border-white/10 bg-white/[0.05] px-2.5 py-1"
                >
                  <div className="text-[10px] font-semibold tracking-wider text-white/45">
                    {s.label}
                  </div>
                  <div className="text-base font-bold text-white tabular-nums">{s.value}</div>
                </div>
              ))}
            </div>
          )}
          {desc && (desc.text || desc.materials) && (
            <div
              data-testid="rip-desc"
              className="min-h-0 w-full overflow-y-auto overscroll-contain rounded-md border border-white/[0.07] bg-black/25 px-3 py-2 text-[13px] leading-relaxed whitespace-pre-line text-white/80"
            >
              {desc.materials && (
                <p data-testid="rip-materials" className="mb-1.5 text-white/50">
                  {desc.materials}
                </p>
              )}
              {desc.text}
            </div>
          )}
        </>
      )}
    </div>
  )
}
