import { useEffect, useState } from 'react'
import { XIcon } from 'lucide-react'
import { ANDROID_CHANNEL, APP_PLATFORM } from '@/lib/portal'
import { UPDATE_DISMISSED_KEY, checkForUpdate, type Update } from './updateCheck'

const appVersion = (): string => (typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev')

const defaultCheck = (): Promise<Update | null> =>
  checkForUpdate({
    fetch: (i, n) => fetch(i, n),
    now: () => Date.now(),
    storage: localStorage,
    current: appVersion()
  })

/** The update line, in the Android APK build only. `check` is for tests. */
export function UpdateBanner({
  check = defaultCheck
}: {
  check?: () => Promise<Update | null>
}): React.JSX.Element | null {
  const enabled = APP_PLATFORM === 'android' && ANDROID_CHANNEL === 'apk'
  const [update, setUpdate] = useState<Update | null>(null)
  useEffect(() => {
    if (!enabled) return
    let live = true
    void check().then((found) => {
      if (live && found && localStorage.getItem(UPDATE_DISMISSED_KEY) !== found.version)
        setUpdate(found)
    })
    return () => {
      live = false
    }
  }, [enabled, check])

  if (!enabled || !update) return null
  return (
    <div className="relative z-30 flex shrink-0 items-center gap-2 border-t border-white/[0.06] bg-background/90 px-4 py-2 text-sm backdrop-blur-xl">
      <a
        href={update.url}
        target="_blank"
        rel="noreferrer"
        className="flex-1 font-medium text-primary underline-offset-4 hover:underline"
      >
        Update to {update.version}
      </a>
      <button
        type="button"
        aria-label="Dismiss update"
        className="-m-2 p-2 text-muted-foreground"
        onClick={() => {
          localStorage.setItem(UPDATE_DISMISSED_KEY, update.version)
          setUpdate(null)
        }}
      >
        <XIcon className="size-4" />
      </button>
    </div>
  )
}
