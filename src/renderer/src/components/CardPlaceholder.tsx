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

/** Pokémon's frame, art window, line and sparkle colours; the same in either theme, like a card. */
const PKM = {
  frame: '#f2c230',
  edge: '#b98a12',
  panel: '#2b3a67',
  line: '#c9d6ff',
  gold: '#ffd84d'
}

/**
 * Pokémon's: drawn on its 600×825 card. A yellow frame, a blue art window with rings round a gold
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
      <defs>
        <radialGradient id="pkm-placeholder-art" cx="50%" cy="50%" r="65%">
          <stop offset="0%" stopColor="#4a67c9" />
          <stop offset="100%" stopColor="#1b2750" />
        </radialGradient>
      </defs>
      <rect width="600" height="825" fill={PKM.frame} />
      <rect x="26" y="26" width="548" height="773" rx="26" fill={PKM.panel} />
      {/* Name bar and a small dot at its end. */}
      <rect x="64" y="64" width="250" height="26" rx="13" fill={PKM.line} opacity="0.7" />
      <circle cx="520" cy="77" r="20" fill="none" stroke={PKM.gold} strokeWidth="7" />
      {/* The art window. */}
      <rect
        x="64"
        y="116"
        width="472"
        height="428"
        rx="14"
        fill="url(#pkm-placeholder-art)"
        stroke={PKM.edge}
        strokeWidth="6"
      />
      <g fill="none" stroke={PKM.line} strokeWidth="6">
        <circle cx={cx} cy={cy} r="150" opacity="0.3" />
        <circle cx={cx} cy={cy} r="104" opacity="0.55" />
      </g>
      <g transform={`translate(${cx} ${cy})`} fill={PKM.gold}>
        <path d={sparkle(86)} />
      </g>
      <g fill={PKM.gold} opacity="0.8">
        <path d={sparkle(22)} transform="translate(150 200)" />
        <path d={sparkle(16)} transform="translate(462 452)" />
        <circle cx="446" cy="214" r="6" />
        <circle cx="152" cy="438" r="5" />
      </g>
      {/* Text lines and a row of energy-like dots. */}
      <g fill={PKM.line} opacity="0.4">
        <rect x="64" y="590" width="472" height="14" rx="7" />
        <rect x="64" y="624" width="400" height="14" rx="7" />
        <rect x="64" y="658" width="330" height="14" rx="7" />
      </g>
      <circle cx="84" cy="738" r="17" fill="#ef6a4c" />
      <circle cx="132" cy="738" r="17" fill="#4fa8e8" />
      <circle cx="180" cy="738" r="17" fill="#6ec46a" />
      <rect x="430" y="728" width="106" height="14" rx="7" fill={PKM.line} opacity="0.4" />
    </svg>
  )
}

/** What shows where a card's art can't: a card-shaped stand-in in the card's game. */
export function CardPlaceholder({ game, ...rest }: CardPlaceholderProps): React.JSX.Element {
  return game === 'pkm' ? <PkmPlaceholder {...rest} /> : <YgoPlaceholder {...rest} />
}
