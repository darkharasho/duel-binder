import { memo } from 'react'
import { spriteSrc } from '@/lib/images'
import { useChunkedList } from '@/lib/useChunkedList'
import { cn } from '@/lib/utils'
import { byGeneration, dexNumber, percent, progress, type DexTile } from './pokedexView'

/** A sprite that fails to load (none uploaded yet, offline) is hidden: its tile keeps the name and number. */
const hideBroken = (e: React.SyntheticEvent<HTMLImageElement>): void => {
  e.currentTarget.style.visibility = 'hidden'
}

/** A species' pixel sprite: in colour once caught, a black silhouette while missing. */
export function DexSprite({
  dexNo,
  caught,
  className
}: {
  dexNo: number
  caught: boolean
  className?: string
}): React.JSX.Element {
  return (
    <img
      src={spriteSrc(dexNo)}
      alt=""
      width={96}
      height={96}
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={hideBroken}
      style={{ imageRendering: 'pixelated' }}
      className={cn('object-contain', !caught && 'opacity-30 brightness-0', className)}
    />
  )
}

/** A thin caught / total line. */
export function DexBar({
  caught,
  total,
  className
}: {
  caught: number
  total: number
  className?: string
}): React.JSX.Element {
  const pct = percent({ caught, total })
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      className={cn('w-full overflow-hidden rounded-full bg-white/10', className)}
    >
      <div
        className="h-full rounded-full bg-complete"
        style={{ width: `${(total === 0 ? 0 : caught / total) * 100}%` }}
      />
    </div>
  )
}

const Tile = memo(function Tile({
  tile,
  onOpen
}: {
  tile: DexTile
  onOpen: (dexNo: number) => void
}): React.JSX.Element {
  const caught = tile.copies > 0
  return (
    <li className="lazy-item [--lazy-h:128px]">
      <button
        type="button"
        data-caught={caught}
        onClick={() => onOpen(tile.dexNo)}
        className="relative flex aspect-square w-full flex-col items-center justify-center rounded-md bg-white/[0.03] p-1.5 text-center outline-none transition-colors duration-150 hover:bg-white/[0.07] focus-visible:ring-2 focus-visible:ring-ring"
      >
        <DexSprite dexNo={tile.dexNo} caught={caught} className="size-16 max-md:size-12" />
        <span
          data-dex-name
          className={cn(
            'w-full truncate text-xs font-medium',
            !caught && 'text-muted-foreground/70'
          )}
        >
          {tile.name}
        </span>
        <span className="font-mono text-[10px] text-muted-foreground">{dexNumber(tile.dexNo)}</span>
        {!caught && <span className="sr-only">, not caught</span>}
        {tile.copies > 1 && (
          <span className="absolute right-1 top-1 rounded-full bg-primary px-1.5 font-mono text-[10px] font-semibold text-primary-foreground shadow">
            ×{tile.copies}
          </span>
        )}
      </button>
    </li>
  )
})

/**
 * The species tiles by generation, each with its heading and caught / total (counted over `all`, so
 * the Caught and Missing filters don't change it). The first screenful renders at once, the rest in
 * idle steps as the scroll nears, and off-screen tiles skip layout and paint (`lazy-item`).
 */
export function PokedexGrid({
  all,
  tiles,
  onOpen
}: {
  all: DexTile[]
  tiles: DexTile[]
  onOpen: (dexNo: number) => void
}): React.JSX.Element {
  const [shown, endRef] = useChunkedList(tiles)
  return (
    <div ref={endRef} className="space-y-8">
      {byGeneration(shown).map(({ gen, tiles: genTiles }) => {
        const p = progress(all, gen.gen)
        return (
          <section key={gen.gen} aria-label={`Generation ${gen.label}`} className="space-y-3">
            <div className="space-y-1.5">
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="text-sm font-semibold">
                  Generation {gen.label} · {gen.region}
                </h2>
                <span className="font-mono text-xs text-muted-foreground tabular-nums">
                  {p.caught} / {p.total}
                </span>
              </div>
              <DexBar caught={p.caught} total={p.total} className="h-0.5" />
            </div>
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(100px,1fr))] gap-2 max-md:grid-cols-4 max-md:gap-1.5">
              {genTiles.map((t) => (
                <Tile key={t.dexNo} tile={t} onOpen={onOpen} />
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}
