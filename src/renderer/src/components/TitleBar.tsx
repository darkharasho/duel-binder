import { useEffect, useState } from 'react'
import { Minus, Square, X } from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

const noDrag = '[-webkit-app-region:no-drag]'

/** Linux has no native caption buttons once the frame is hidden, so draw GNOME-style ones. */
function LinuxControls(): React.JSX.Element {
  const [maximized, setMaximized] = useState(false)
  useEffect(() => {
    void api.window.isMaximized().then(setMaximized)
    return api.window.onMaximizedChange(setMaximized)
  }, [])
  const button = cn(
    noDrag,
    'flex size-6 items-center justify-center rounded-full bg-white/[0.08] text-foreground/80 transition-colors hover:bg-white/[0.16] hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring [&_svg]:size-3.5'
  )
  return (
    <div className="flex items-center gap-3 pr-3">
      <button
        type="button"
        aria-label="Minimize"
        className={button}
        onClick={() => void api.window.minimize()}
      >
        <Minus />
      </button>
      <button
        type="button"
        aria-label={maximized ? 'Restore' : 'Maximize'}
        className={button}
        onClick={() => void api.window.toggleMaximize()}
      >
        <Square className={maximized ? 'size-3!' : undefined} />
      </button>
      <button
        type="button"
        aria-label="Close"
        className={button}
        onClick={() => void api.window.close()}
      >
        <X />
      </button>
    </div>
  )
}

/**
 * The window's title bar, drawn by the app so it matches the theme. It is a drag strip: macOS
 * places its traffic lights at the left, Windows overlays native caption buttons at the right.
 */
export function TitleBar(): React.JSX.Element {
  const platform = api.window.platform
  return (
    <div
      data-testid="title-bar"
      onDoubleClick={platform === 'linux' ? () => void api.window.toggleMaximize() : undefined}
      className={cn(
        'flex h-9 shrink-0 items-center [-webkit-app-region:drag] select-none',
        platform === 'darwin' && 'pl-20',
        platform === 'win32' && 'pr-[140px]'
      )}
    >
      <div className="flex-1" />
      {platform === 'linux' && <LinuxControls />}
    </div>
  )
}
