import { cn } from '@/lib/utils'
import { cssAspect, type CardAspect, type GameId } from '@shared/games'

interface CardPlaceholderProps {
  game: GameId
  className?: string
  label: string
  aspect: CardAspect
}

const TONE = 'text-zinc-400 dark:text-zinc-500'

/** Yu-Gi-Oh!'s: drawn on its 421×614 card, scaled to the aspect: a 24-unit border, an oval in the middle. */
function YgoPlaceholder({
  className,
  label,
  aspect
}: Omit<CardPlaceholderProps, 'game'>): React.JSX.Element {
  const { width: w, height: h } = aspect
  return (
    <svg
      role="img"
      aria-label={label}
      data-testid="card-art-placeholder"
      data-game="ygo"
      viewBox={`0 0 ${w} ${h}`}
      style={{ aspectRatio: cssAspect(aspect) }}
      className={cn('rounded-[6px] shadow-sm', className)}
    >
      <rect width={w} height={h} fill="currentColor" className="text-zinc-300 dark:text-zinc-700" />
      <rect
        x="24"
        y="24"
        width={w - 48}
        height={h - 48}
        rx="8"
        fill="none"
        stroke="currentColor"
        strokeWidth="6"
        className={TONE}
      />
      <ellipse
        cx={w / 2}
        cy={h / 2}
        rx={(92 * w) / 421}
        ry={(132 * h) / 614}
        fill="none"
        stroke="currentColor"
        strokeWidth="6"
        className={TONE}
      />
    </svg>
  )
}

/** A four-point sparkle centred on (0, 0), `r` from the middle to each tip. */
const sparkle = (r: number): string => {
  const k = r * 0.16
  return `M0 ${-r} Q${k} ${-k} ${r} 0 Q${k} ${k} 0 ${r} Q${-k} ${k} ${-r} 0 Q${-k} ${-k} 0 ${-r}Z`
}

/**
 * Pokémon's: drawn on its 600×825 card. A card-shaped frame, an art window with rings round a
 * sparkle (an original motif, not any game's mark), and a few text bars and dots below.
 */
function PkmPlaceholder({
  className,
  label,
  aspect
}: Omit<CardPlaceholderProps, 'game'>): React.JSX.Element {
  const cx = 300
  const cy = 330
  return (
    <svg
      role="img"
      aria-label={label}
      data-testid="card-art-placeholder"
      data-game="pkm"
      viewBox="0 0 600 825"
      style={{ aspectRatio: cssAspect(aspect) }}
      className={cn('rounded-[6px] shadow-sm', className)}
    >
      <rect
        width="600"
        height="825"
        fill="currentColor"
        className="text-zinc-300 dark:text-zinc-800"
      />
      <rect
        x="26"
        y="26"
        width="548"
        height="773"
        rx="26"
        fill="none"
        stroke="currentColor"
        strokeWidth="8"
        className={TONE}
      />
      {/* Name bar and a small dot at its end. */}
      <rect
        x="64"
        y="64"
        width="250"
        height="26"
        rx="13"
        fill="currentColor"
        className={TONE}
        opacity="0.55"
      />
      <circle
        cx="520"
        cy="77"
        r="20"
        fill="none"
        stroke="currentColor"
        strokeWidth="7"
        className={TONE}
      />
      {/* The art window. */}
      <rect
        x="64"
        y="116"
        width="472"
        height="428"
        rx="14"
        fill="currentColor"
        className="text-zinc-200 dark:text-zinc-900"
      />
      <rect
        x="64"
        y="116"
        width="472"
        height="428"
        rx="14"
        fill="none"
        stroke="currentColor"
        strokeWidth="6"
        className={TONE}
      />
      <g fill="none" stroke="currentColor" strokeWidth="6" className={TONE}>
        <circle cx={cx} cy={cy} r="150" opacity="0.4" />
        <circle cx={cx} cy={cy} r="104" opacity="0.7" />
      </g>
      <g transform={`translate(${cx} ${cy})`} fill="currentColor" className={TONE}>
        <path d={sparkle(86)} />
      </g>
      <g fill="currentColor" className={TONE} opacity="0.7">
        <path d={sparkle(22)} transform="translate(150 200)" />
        <path d={sparkle(16)} transform="translate(462 452)" />
        <circle cx="446" cy="214" r="6" />
        <circle cx="152" cy="438" r="5" />
      </g>
      {/* Text lines and a row of energy-like dots. */}
      <g fill="currentColor" className={TONE} opacity="0.45">
        <rect x="64" y="590" width="472" height="14" rx="7" />
        <rect x="64" y="624" width="400" height="14" rx="7" />
        <rect x="64" y="658" width="330" height="14" rx="7" />
      </g>
      <g fill="none" stroke="currentColor" strokeWidth="6" className={TONE}>
        <circle cx="84" cy="738" r="16" />
        <circle cx="132" cy="738" r="16" opacity="0.6" />
        <circle cx="180" cy="738" r="16" opacity="0.35" />
      </g>
      <rect
        x="430"
        y="728"
        width="106"
        height="14"
        rx="7"
        fill="currentColor"
        className={TONE}
        opacity="0.45"
      />
    </svg>
  )
}

/** What shows where a card's art can't: a card-shaped stand-in in the card's game. */
export function CardPlaceholder({ game, ...rest }: CardPlaceholderProps): React.JSX.Element {
  return game === 'pkm' ? <PkmPlaceholder {...rest} /> : <YgoPlaceholder {...rest} />
}
