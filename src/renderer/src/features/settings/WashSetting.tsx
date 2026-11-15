import type { Prefs, WashColours, WashMode } from '@shared/prefs'
import { FilterOptionChip } from '@/components/FilterChip'
import { useGame } from '@/lib/game'
import { useWashPref } from '@/lib/washPref'
import { fit } from '@/lib/wash/fit'
import { field } from '@/lib/wash/field'
import { gameFallback, rememberedCard } from '@/lib/wash/sample'

const OPTIONS: { mode: WashMode; label: string }[] = [
  { mode: 'random', label: 'Random' },
  { mode: 'locked', label: 'Locked' },
  { mode: 'colourless', label: 'Colourless' }
]

/** Background: Random (each page's own), Locked (one saved colour scheme) or Colourless. `compact` is the phone layout. */
export function WashSetting({ compact = false }: { compact?: boolean }): React.JSX.Element {
  const { game } = useGame()
  const { wash, setWash } = useWashPref()

  const roll = (): WashColours => {
    const { greyArt: _grey, ...colours } =
      rememberedCard(game, Math.random)?.families ?? gameFallback(game, Math.random)
    return colours
  }

  const choose = (mode: WashMode): void => {
    // The whole value is replaced on save, so saved colours are sent again to survive a mode change.
    const next: Prefs['wash'] = wash.locked ? { mode, locked: wash.locked } : { mode }
    if (mode === 'locked' && !next.locked) next.locked = roll()
    setWash(next)
  }

  return (
    <div
      className={
        compact
          ? 'flex flex-wrap items-center gap-2'
          : 'flex flex-wrap items-center justify-end gap-2'
      }
    >
      {wash.mode === 'locked' && wash.locked && (
        <>
          <span
            data-testid="wash-swatch"
            aria-hidden
            className="size-7 shrink-0 rounded-md border border-border"
            style={{
              background: field(fit({ ...wash.locked, greyArt: false }, 'dark'), { seed: 1 })
            }}
          />
          <button
            type="button"
            onClick={() => setWash({ mode: 'locked', locked: roll() })}
            className="inline-flex h-7 items-center rounded-full bg-chip px-2.5 font-mono text-xs font-medium outline-none hover:bg-chip/70 focus-visible:ring-2 focus-visible:ring-ring"
          >
            Randomize
          </button>
        </>
      )}
      <div role="group" aria-label="Background" className="flex gap-1.5">
        {OPTIONS.map((o) => (
          <FilterOptionChip
            key={o.mode}
            label={o.label}
            selected={wash.mode === o.mode}
            onClick={() => choose(o.mode)}
          />
        ))}
      </div>
    </div>
  )
}
