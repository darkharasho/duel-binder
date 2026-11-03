import { isPhone } from '@/lib/platform'

/**
 * A card panel's layout. On desktop: the header, then the art and the rest in one column. On the
 * phone the art stays pinned at the top and the header and the rest sit on a frosted drawer just
 * below it, so the details show at once; scrolling pulls the drawer up over the art, which blurs
 * behind it.
 */
export function CardDrawer({
  header,
  art,
  children
}: {
  header: React.ReactNode
  art: React.ReactNode
  children: React.ReactNode
}): React.JSX.Element {
  if (!isPhone()) {
    return (
      <>
        {header}
        <div className="space-y-5 px-4 pb-6">
          {art}
          {children}
        </div>
      </>
    )
  }
  return (
    <>
      {/* Pinned under the sheet's back bar (2.75rem); the drawer scrolls up over it. */}
      {art && <div className="card-drawer-art sticky top-11 z-0 origin-top px-4 pt-2">{art}</div>}
      <section
        aria-label="Card details"
        data-testid="card-drawer"
        className="relative z-[5] -mt-6 min-h-[70dvh] rounded-t-[28px] border-t border-white/[0.1] bg-background/60 shadow-[0_-12px_40px_rgb(0_0_0/0.35)] backdrop-blur-2xl"
      >
        <div aria-hidden className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-white/25" />
        {header}
        <div className="space-y-5 px-4 pb-6">{children}</div>
      </section>
    </>
  )
}
