import { useEffect, useState } from 'react'
import { XIcon } from 'lucide-react'
import { ANDROID_CHANNEL, APP_PLATFORM } from '@/lib/portal'
import { isNewer } from '../shared/androidRelease'
import { UPDATE_DISMISSED_KEY, readShellUpdate, type Update } from './updateCheck'

const readVisible = (): Update | null => {
  const found = readShellUpdate(localStorage)
  if (!found || localStorage.getItem(UPDATE_DISMISSED_KEY) === found.version) return null
  // Just installed that APK: the stored answer is stale until the next check replaces it.
  if (typeof __APP_VERSION__ === 'string' && !isNewer(found.version, __APP_VERSION__)) return null
  return found
}

/** The update line, in the Android APK build only. Reads what the live-update check stored. */
export function UpdateBanner(): React.JSX.Element | null {
  const enabled = APP_PLATFORM === 'android' && ANDROID_CHANNEL === 'apk'
  const [update, setUpdate] = useState<Update | null>(() => (enabled ? readVisible() : null))
  useEffect(() => {
    if (!enabled) return
    const sync = (): void => setUpdate(readVisible())
    sync()
    window.addEventListener('duelbinder:shell-update', sync)
    return () => window.removeEventListener('duelbinder:shell-update', sync)
  }, [enabled])

  if (!enabled || !update) return null
  return (
    <div className="relative z-30 flex shrink-0 items-center gap-2 px-4 py-2 text-sm">
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
