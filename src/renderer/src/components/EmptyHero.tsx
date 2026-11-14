import type { LucideIcon } from 'lucide-react'
import { useGame } from '@/lib/game'
import { cn } from '@/lib/utils'

/**
 * A page with nothing in it yet: the game, a big heading and a line on what the page is for,
 * then the page's ways to start (`children`). The dashboard's empty collection set the look.
 */
export function EmptyHero({
  id,
  title,
  blurb,
  eyebrow,
  children,
  className
}: {
  /** Labels the section; must be unique on the page. */
  id: string
  title: string
  blurb: React.ReactNode
  /** The small line over the heading; the game's name when left out. */
  eyebrow?: string
  children?: React.ReactNode
  className?: string
}): React.JSX.Element {
  const { def } = useGame()
  return (
    <section
      aria-labelledby={id}
      className={cn('mx-auto max-w-4xl pt-10 pb-6 max-md:pt-4', className)}
    >
      <div className="flex flex-col items-center text-center">
        <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
          {eyebrow ?? def.name}
        </p>
        <h2 id={id} className="mt-2 text-3xl font-semibold tracking-tight max-md:text-2xl">
          {title}
        </h2>
        <p className="mt-2 max-w-md text-sm text-muted-foreground">{blurb}</p>
      </div>
      {children}
    </section>
  )
}

/** A row of three short "how it works" steps under an EmptyHero. */
export function EmptySteps({
  steps
}: {
  steps: readonly { icon: LucideIcon; title: string; text: string }[]
}): React.JSX.Element {
  return (
    <ol className="mt-14 grid grid-cols-3 gap-5 max-md:grid-cols-1 max-md:gap-3">
      {steps.map(({ icon: Icon, title, text }, i) => (
        <li
          key={title}
          className="rounded-xl border border-white/[0.06] bg-card/60 p-5 max-md:flex max-md:items-start max-md:gap-4 max-md:p-4"
        >
          <div className="flex items-center gap-3 max-md:shrink-0">
            <span className="grid size-9 place-items-center rounded-lg bg-white/[0.06]">
              <Icon aria-hidden className="size-[18px] text-foreground/80" />
            </span>
            <span className="font-mono text-xs text-muted-foreground max-md:hidden">
              {String(i + 1).padStart(2, '0')}
            </span>
          </div>
          <div className="mt-4 max-md:mt-0">
            <p className="text-sm font-semibold">{title}</p>
            <p className="mt-1 text-sm text-muted-foreground">{text}</p>
          </div>
        </li>
      ))}
    </ol>
  )
}
