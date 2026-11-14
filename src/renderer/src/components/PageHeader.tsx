import { useGame } from '@/lib/game'
import { isPhone } from '@/lib/platform'
import { cn } from '@/lib/utils'
import { GameChip } from './GameSwitch'

/** The big condensed page title: 96 px, 56 px under 1100 px. For a page that draws its own h1. */
export const PAGE_TITLE = 'font-display text-[56px] leading-[.8] min-[1100px]:text-[96px]'

export interface PageStat {
  label: string
  value: React.ReactNode
}

/**
 * A page's header, first in a `p-8` page (`max-md:p-4` under 768 px). It has no box: the page's art
 * wash shows through, and it scrolls away with the page. `title` is the big condensed heading
 * (96 px, 56 px under 1100 px); `stats` sit right-aligned beside it, a mono value over a mono label.
 * Pages that draw their own heading pass it as children. On the phone it carries the game chip at its
 * right when the account has more than one game.
 */
export function PageHeader({
  className,
  title,
  stats,
  children
}: {
  className?: string
  title?: string
  stats?: PageStat[]
  children?: React.ReactNode
}): React.JSX.Element {
  const { available } = useGame()
  const chip = isPhone() && available.length > 1
  const heading =
    title || stats?.length ? (
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
        {title && <h1 className={cn(PAGE_TITLE, 'min-w-0')}>{title}</h1>}
        {stats && stats.length > 0 && (
          <dl className="ml-auto flex gap-8 text-right">
            {stats.map((s) => (
              <div key={s.label} className="flex flex-col-reverse">
                <dt className="font-mono text-[10.5px] uppercase tracking-[1.5px]">{s.label}</dt>
                <dd className="font-mono text-[30px] font-medium leading-none">{s.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    ) : null
  const body = (
    <>
      {heading}
      {children}
    </>
  )
  return (
    <div data-page-header className={cn('space-y-3 pb-3', isPhone() && 'relative', className)}>
      {chip ? (
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1 space-y-3">{body}</div>
          <GameChip />
        </div>
      ) : (
        body
      )}
    </div>
  )
}
