import { cn } from '@/lib/utils'

/** A page's title bar, pinned to the top of the scrolling main area. Sits first in a `p-8` page. */
export function PageHeader({
  className,
  children
}: {
  className?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div
      className={cn(
        'sticky top-0 z-20 -mx-8 -mt-8 space-y-3 border-b border-white/[0.06] bg-background/60 px-8 pb-3 pt-3 backdrop-blur-xl',
        className
      )}
    >
      {children}
    </div>
  )
}
