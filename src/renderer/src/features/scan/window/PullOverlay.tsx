import { useEffect, useState } from 'react'
import { CopyIcon, StarIcon } from 'lucide-react'
import { englishSetName } from '@shared/setNames'
import { CardArt } from '@/components/CardArt'
import { useReverseLook } from '@/components/useReverseLook'
import { formatUsd } from '@/lib/format'
import { cn } from '@/lib/utils'
import { FoundBurst } from '../FoundBurst'
import { isNewCard, ownedText, useOwned } from '../owned'
import { Confetti } from './Confetti'
import { FADE_MS, type Pull } from './overlay'

const fade = { transitionDuration: `${FADE_MS}ms`, animationDuration: `${FADE_MS}ms` }

function Range({ range }: { range: NonNullable<Pull['range']> }): React.JSX.Element {
  return (
    <p className="text-[clamp(0.75rem,1.4vw,1.3rem)] text-emerald-200/80 tabular-nums">
      {formatUsd(range.low)} – {formatUsd(range.high)}
    </p>
  )
}

/** Marks a slab's price as the raw card's. */
function Raw(): React.JSX.Element {
  return <span className="text-[clamp(0.75rem,1.4vw,1.3rem)] text-emerald-200/80">Raw</span>
}

/**
 * "New card" or "Own 3", for a pull the main window has counted: until then the list's copies
 * aren't known, and a second copy would flash as new.
 */
function OwnedLine({
  pull,
  scanned,
  className
}: {
  pull: Pull
  scanned: number | undefined
  className: string
}): React.JSX.Element | null {
  const owned = useOwned(pull.cardId, pull.printingId, { fresh: true })
  if (owned === null || scanned === undefined) return null
  return (
    <p
      className={cn(
        'flex items-center gap-[0.4vw]',
        className,
        isNewCard(owned) && 'font-semibold text-sky-300'
      )}
    >
      <CopyIcon aria-hidden className="size-[1.1em] shrink-0" />
      <span className="truncate">{ownedText(owned, scanned, pull.game)}</span>
    </p>
  )
}

/** The phone's last-scan card, sized to the window: art, name, set, price and rarity. */
function Bar({
  pull,
  scanned,
  phone = false
}: {
  pull: Pull
  scanned?: number
  phone?: boolean
}): React.JSX.Element {
  const sub = [pull.setCode, pull.setName === null ? null : englishSetName(pull.setName)]
    .filter((s) => s !== null)
    .join(' · ')
  const reverse = useReverseLook(pull, pull.rarity, pull.setCode)
  return (
    <div
      role="status"
      aria-label="Pull"
      className={
        phone
          ? // Full width with margins upright; sideways it hugs the bottom left and leaves the card.
            'absolute inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] flex max-w-none gap-3 rounded-2xl border border-white/[0.13] bg-black/45 p-2.5 pr-4 text-white shadow-[0_10px_40px_rgba(0,0,0,0.4)] backdrop-blur-xl landscape:right-auto landscape:left-[max(0.75rem,env(safe-area-inset-left))] landscape:max-w-[55vw]'
          : 'absolute bottom-[3vw] left-[3vw] flex max-w-[min(70vw,48rem)] gap-[1.2vw] rounded-[clamp(1.25rem,2.6vw,2.25rem)] border border-white/[0.13] bg-black/45 p-[1vw] pr-[2.2vw] text-white shadow-[0_10px_40px_rgba(0,0,0,0.4)] backdrop-blur-xl'
      }
    >
      <CardArt
        imageId={pull.imageId}
        printingId={pull.photoId}
        reverse={reverse}
        size="small"
        alt=""
        className={
          phone
            ? 'w-14 shrink-0 self-start overflow-hidden rounded-md animate-[scan-drop_500ms_ease-in_both]'
            : 'w-[clamp(3rem,6.5vw,5.5rem)] shrink-0 self-start overflow-hidden rounded-[clamp(0.3rem,0.6vw,0.6rem)] animate-[scan-drop_500ms_ease-in_both]'
        }
      />
      <div
        className={cn(
          'min-w-0 leading-snug',
          phone ? 'text-sm' : 'text-[clamp(0.75rem,1.4vw,1.3rem)]'
        )}
      >
        <p
          className={cn(
            'truncate leading-tight font-semibold',
            phone ? 'text-base' : 'text-[clamp(1rem,2.4vw,2.25rem)]'
          )}
        >
          {pull.name}
        </p>
        {pull.guess && <p className="text-amber-300">Best guess</p>}
        {sub && <p className="truncate text-white/60">{sub}</p>}
        {pull.price !== null && (
          <p
            className={cn(
              'flex items-baseline leading-tight font-bold text-emerald-400 tabular-nums',
              phone ? 'gap-2 text-xl' : 'gap-[0.6vw] text-[clamp(1.1rem,2.6vw,2.4rem)]'
            )}
          >
            {formatUsd(pull.price)}
            {pull.raw && <Raw />}
          </p>
        )}
        {pull.range !== null && <Range range={pull.range} />}
        {pull.rarity !== null && (
          <p
            className={cn(
              'flex items-center text-white/75',
              phone ? 'mt-0.5 gap-1.5' : 'mt-[0.2vw] gap-[0.4vw]'
            )}
          >
            <StarIcon aria-hidden className="size-[1.1em] shrink-0" />
            <span className="truncate">{pull.rarity}</span>
          </p>
        )}
        <OwnedLine
          pull={pull}
          scanned={scanned}
          className={phone ? 'mt-0.5 gap-1.5 text-white/75' : 'mt-[0.2vw] text-white/75'}
        />
      </div>
    </div>
  )
}

function Hit({
  pull,
  scanned,
  phone = false
}: {
  pull: Pull
  scanned?: number
  phone?: boolean
}): React.JSX.Element {
  return (
    <div
      role="status"
      aria-label="Hit"
      className={
        phone
          ? // Below the clock and the Dynamic Island, and clear of the notch sideways.
            'absolute inset-x-0 top-0 flex flex-col items-center gap-1.5 px-4 pt-[calc(env(safe-area-inset-top)+0.75rem)] pb-16 text-center text-white landscape:pr-[calc(env(safe-area-inset-right)+1rem)] landscape:pl-[calc(env(safe-area-inset-left)+1rem)]'
          : 'absolute inset-x-0 top-0 flex flex-col items-center gap-[0.6vw] px-[4vw] pt-[3vw] pb-[6vw] text-center text-white'
      }
      style={{
        background:
          'radial-gradient(ellipse 60% 100% at 50% 0%, rgba(251,191,36,0.45), rgba(251,191,36,0) 70%)'
      }}
    >
      {pull.rarity !== null && (
        <p
          className={cn(
            'font-semibold tracking-[0.3em] text-amber-300 uppercase',
            phone ? 'text-sm' : 'text-[clamp(0.8rem,1.5vw,1.4rem)]'
          )}
        >
          {pull.rarity}
        </p>
      )}
      <p
        className={cn(
          'leading-tight font-bold [text-shadow:0_2px_12px_rgba(0,0,0,0.6)]',
          phone ? 'text-[clamp(1.5rem,min(7vw,6vh),3rem)]' : 'text-[clamp(1.6rem,4.5vw,4.5rem)]'
        )}
      >
        {pull.name}
      </p>
      {pull.price !== null && (
        <p
          className={cn(
            'flex items-baseline font-bold text-emerald-400 tabular-nums',
            phone
              ? 'gap-2 text-[clamp(1.25rem,min(6vw,5vh),2.5rem)]'
              : 'gap-[0.6vw] text-[clamp(1.4rem,3.5vw,3.5rem)]'
          )}
        >
          {formatUsd(pull.price)}
          {pull.raw && <Raw />}
        </p>
      )}
      {pull.range !== null && <Range range={pull.range} />}
      <OwnedLine
        pull={pull}
        scanned={scanned}
        className={
          phone
            ? 'gap-1.5 text-base text-white/85 [text-shadow:0_2px_12px_rgba(0,0,0,0.6)]'
            : 'text-[clamp(0.9rem,1.8vw,1.7rem)] text-white/85 [text-shadow:0_2px_12px_rgba(0,0,0,0.6)]'
        }
      />
    </div>
  )
}

/**
 * The pull's card or hit moment, with the phone's "found it" glow and sparkles (and, on a card,
 * its bubble). A pull that ends fades out and stays mounted until the fade does.
 */
export function PullOverlay({
  pull,
  scanned = {},
  phone = false
}: {
  pull: Pull | null
  /** Copies on the list, by the id of the pull the main window acknowledged with it. */
  scanned?: Readonly<Record<string, number>>
  /** On a phone's screen: sizes for a narrow viewer, clear of the safe areas. */
  phone?: boolean
}): React.JSX.Element | null {
  const [shown, setShown] = useState<Pull | null>(pull)
  if (pull !== null && pull !== shown) setShown(pull)

  useEffect(() => {
    if (pull !== null) return
    const timer = setTimeout(() => setShown(null), FADE_MS)
    return () => clearTimeout(timer)
  }, [pull])

  if (shown === null) return null
  const count = shown.id === undefined ? undefined : scanned[shown.id]
  return (
    <div
      // A new pull mounts afresh and fades in; an ended one fades out where it is.
      key={shown.key}
      style={fade}
      className={`pointer-events-none absolute inset-0 animate-in fade-in transition-opacity ${pull === null ? 'opacity-0' : 'opacity-100'}`}
    >
      {shown.hit && <Confetti />}
      {shown.hit ? (
        <Hit pull={shown} scanned={count} phone={phone} />
      ) : (
        <Bar pull={shown} scanned={count} phone={phone} />
      )}
      <FoundBurst name={shown.name} price={shown.price} stream phone={phone} bubble={!shown.hit} />
    </div>
  )
}
