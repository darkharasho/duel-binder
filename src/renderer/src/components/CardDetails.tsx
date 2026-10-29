import type { CardRow, Printing } from '@shared/types'
import { useGame } from '@/lib/game'

/**
 * A card's facts and rules text, shown under its art in the side panels. Yu-Gi-Oh! shows its
 * stats line; Pokémon, whose stats aren't in the card row, shows the printing being viewed in the
 * game's words (its number and version).
 */
export function CardDetails({
  card,
  printing
}: {
  card: CardRow | undefined
  printing?: Pick<Printing, 'setCode' | 'setRarity'>
}): React.JSX.Element | null {
  const { def } = useGame()
  if (!card) return null
  const stats =
    def.id === 'ygo'
      ? [
          card.atk !== null && `ATK ${card.atk}`,
          card.def !== null && `DEF ${card.def}`,
          card.level !== null && `Level ${card.level}`,
          card.linkval !== null && `Link ${card.linkval}`
        ].filter(Boolean)
      : []
  const facts =
    def.id !== 'ygo' && printing
      ? [
          { label: def.vocab.printingCode, value: printing.setCode },
          { label: def.vocab.rarity, value: printing.setRarity }
        ].filter((f) => f.value)
      : []
  return (
    <div className="space-y-2">
      {stats.length > 0 && (
        <div className="text-sm tabular-nums text-muted-foreground">{stats.join(' · ')}</div>
      )}
      {facts.length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          {facts.map((f) => (
            <div key={f.label} className="contents">
              <dt className="text-muted-foreground">{f.label}</dt>
              <dd className="tabular-nums">{f.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {card.desc && <p className="whitespace-pre-line text-sm">{card.desc}</p>}
    </div>
  )
}
