import { useGame } from '@/lib/game'
import type { GameId } from '@shared/games'

/**
 * Soft glows for a page with no art to blur (or art still loading, or near black): radial
 * gradients in the game's colours over the app's own background. Static, so it costs one paint.
 */
const GLOW: Record<GameId, string> = {
  ygo: 'radial-gradient(ellipse 75% 85% at 12% -10%, rgb(139 92 246 / 0.42), transparent 75%), radial-gradient(ellipse 60% 70% at 92% 0%, rgb(245 158 11 / 0.26), transparent 75%), radial-gradient(ellipse 50% 45% at 50% 70%, rgb(217 70 239 / 0.1), transparent 75%)',
  pkm: 'radial-gradient(ellipse 75% 85% at 12% -10%, rgb(37 99 235 / 0.46), transparent 75%), radial-gradient(ellipse 60% 70% at 92% 0%, rgb(250 204 21 / 0.26), transparent 75%), radial-gradient(ellipse 50% 45% at 50% 70%, rgb(239 68 68 / 0.1), transparent 75%)'
}

const FADE = '[mask-image:linear-gradient(180deg,#000_25%,transparent)]'

/**
 * A heavily blurred copy of the page's key art, fading out down the window, over a quiet glow in
 * the game's colours that shows alone where there is no art. Purely decorative. `glow` is off
 * where something else (the phone's camera) fills the background.
 */
export function ArtWash({
  src,
  glow = true
}: {
  src: string | null
  glow?: boolean
}): React.JSX.Element | null {
  const { game } = useGame()
  if (!src && !glow) return null
  return (
    <>
      {glow && (
        <div
          aria-hidden
          data-testid="art-glow"
          data-game={game}
          className={`pointer-events-none absolute inset-x-0 top-0 -z-10 h-[560px] ${FADE}`}
          style={{ backgroundImage: GLOW[game] }}
        />
      )}
      {src && (
        <div
          aria-hidden
          data-testid="art-wash"
          className={`pointer-events-none absolute inset-x-0 top-0 -z-10 h-[560px] overflow-hidden ${FADE}`}
        >
          <div
            key={src}
            className="absolute -inset-16 animate-in fade-in bg-cover bg-[center_30%] opacity-30 blur-[70px] saturate-[1.15] duration-700"
            style={{ backgroundImage: `url("${src}")` }}
          />
        </div>
      )}
    </>
  )
}
