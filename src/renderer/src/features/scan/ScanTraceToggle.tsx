import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FileSearch } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import { useAccountUser } from '@/lib/accountUser'
import { isWeb } from '@/lib/platform'
import { scanTraceOn, setScanTraceOn } from './scanTrace'

/**
 * Admin, desktop only: the switch for the scan trace, which writes how each frame is identified
 * to a folder on this computer (scanTrace.ts). Takes effect the next time scanning starts.
 */
export function ScanTraceToggle(): React.JSX.Element | null {
  const { user } = useAccountUser()
  const [on, setOn] = useState(scanTraceOn)
  const admin = !!user?.admin && !isWeb()
  const dir = useQuery({
    queryKey: ['scan', 'traceDir'],
    queryFn: () => api.scan.traceDir(),
    enabled: admin && on,
    staleTime: Infinity
  })
  if (!admin) return null
  return (
    <div className="flex flex-col gap-1">
      <Button
        variant="outline"
        size="sm"
        className="self-start"
        aria-pressed={on}
        title="Writes how each frame is identified to a folder on this computer (admin)"
        onClick={() => {
          setScanTraceOn(!on)
          setOn(!on)
        }}
      >
        <FileSearch aria-hidden />
        {on ? 'Scan trace on' : 'Scan trace off'}
      </Button>
      {on && (
        <p className="text-xs text-muted-foreground">
          From the next time scanning starts, tracing to {dir.data ?? '…'}{' '}
          <button
            type="button"
            className="underline underline-offset-2 hover:text-foreground"
            onClick={() => void api.scan.openTraceDir().catch(() => undefined)}
          >
            Open folder
          </button>
        </p>
      )}
    </div>
  )
}
