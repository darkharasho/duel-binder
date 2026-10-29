import { CheckIcon, ChevronDownIcon } from 'lucide-react'
import { DropdownMenu as DropdownMenuPrimitive } from 'radix-ui'
import { toast } from 'sonner'
import { GAMES, type GameId } from '@shared/games'
import logo from '@/assets/logo.svg'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { useGame } from '@/lib/game'
import { cn } from '@/lib/utils'

/** The game's colour dot. */
export function GameDot({
  game,
  className
}: {
  game: GameId
  className?: string
}): React.JSX.Element {
  return (
    <span
      aria-hidden
      className={cn('size-[7px] shrink-0 rounded-full', className)}
      style={{ backgroundColor: GAMES[game].color }}
    />
  )
}

/** Switches the game, saying so when the switch fails. */
function useSwitch(): (g: string) => void {
  const { game, setGame } = useGame()
  return (g) => {
    if (g === game) return
    setGame(g as GameId).catch((e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Couldn't switch the game")
    )
  }
}

/** The menu of games, with a ✓ on the one shown. */
function GameMenu({ align }: { align: 'start' | 'end' }): React.JSX.Element {
  const { game, available } = useGame()
  const choose = useSwitch()
  return (
    <DropdownMenuContent align={align} className="min-w-44 border-white/10 bg-card shadow-lg">
      <DropdownMenuRadioGroup value={game} onValueChange={choose}>
        {available.map((g) => (
          <DropdownMenuPrimitive.RadioItem
            key={g}
            value={g}
            className="relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden focus:bg-accent focus:text-accent-foreground"
          >
            <GameDot game={g} />
            {GAMES[g].name}
            <DropdownMenuPrimitive.ItemIndicator className="ml-auto">
              <CheckIcon className="size-4" />
            </DropdownMenuPrimitive.ItemIndicator>
          </DropdownMenuPrimitive.RadioItem>
        ))}
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  )
}

/**
 * The desktop sidebar's name row as the game switch: the logo and "Duel Binder", the game shown
 * under the name, and a menu of games. Only for accounts with more than one game.
 */
export function SidebarGameSwitch(): React.JSX.Element {
  const { def } = useGame()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Switch game, showing ${def.name}`}
          className="-mx-2 flex items-center gap-2.5 rounded-md px-2 py-1 text-left transition-colors duration-150 hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-ring data-[state=open]:bg-white/5"
        >
          <img src={logo} alt="" className="h-9 w-9" />
          <span className="min-w-0 flex-1">
            <span className="block whitespace-nowrap text-[15px] font-semibold tracking-[-0.01em]">
              Duel Binder
            </span>
            <span className="flex items-center gap-1.5 whitespace-nowrap text-[11px] text-muted-foreground">
              <GameDot game={def.id} />
              {def.name}
            </span>
          </span>
          <ChevronDownIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <GameMenu align="start" />
    </DropdownMenu>
  )
}

/** The phone's game chip for page headers: the game shown, opening the menu of games. */
export function GameChip({ className }: { className?: string }): React.JSX.Element {
  const { def } = useGame()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Switch game, showing ${def.name}`}
          className={cn(
            'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-white/[0.08] bg-muted px-2.5 py-1 text-[12px] font-semibold',
            className
          )}
        >
          <GameDot game={def.id} />
          {def.name}
        </button>
      </DropdownMenuTrigger>
      <GameMenu align="end" />
    </DropdownMenu>
  )
}

/** The phone's More sheet switch: one segment per game, the one shown raised. */
export function GameSegments(): React.JSX.Element {
  const { game, available } = useGame()
  const choose = useSwitch()
  return (
    <div
      role="radiogroup"
      aria-label="Game"
      className="grid auto-cols-fr grid-flow-col gap-1 rounded-xl border border-white/[0.08] bg-muted p-1"
    >
      {available.map((g) => (
        <button
          key={g}
          type="button"
          role="radio"
          aria-checked={g === game}
          onClick={() => choose(g)}
          className={cn(
            'flex h-10 items-center justify-center gap-2 rounded-lg text-sm font-semibold transition-colors',
            g === game ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground'
          )}
        >
          <GameDot game={g} />
          {GAMES[g].name}
        </button>
      ))}
    </div>
  )
}
