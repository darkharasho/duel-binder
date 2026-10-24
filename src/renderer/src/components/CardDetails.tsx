import type { CardRow } from '@shared/types'

/** A card's stats line and rules text, shown under its art in the side panels. */
export function CardDetails({ card }: { card: CardRow | undefined }): React.JSX.Element | null {
  if (!card) return null
  const stats = [
    card.atk !== null && `ATK ${card.atk}`,
    card.def !== null && `DEF ${card.def}`,
    card.level !== null && `Level ${card.level}`,
    card.linkval !== null && `Link ${card.linkval}`
  ].filter(Boolean)
  return (
    <div className="space-y-2">
      {stats.length > 0 && (
        <div className="text-sm tabular-nums text-muted-foreground">{stats.join(' · ')}</div>
      )}
      {card.desc && <p className="whitespace-pre-line text-sm">{card.desc}</p>}
    </div>
  )
}
