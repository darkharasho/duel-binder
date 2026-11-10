import { useId, useState } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import type { FrameTiming } from '@/features/scan/frameTimes'
import { scanTimingsOn, setScanTimingsOn } from './scanTimingsSetting'

/** Settings' switch for the scanner's timing readout. */
export function ScanTimingsToggle({ className }: { className?: string }): React.JSX.Element {
  const id = useId()
  const [on, setOn] = useState(scanTimingsOn)
  return (
    <div className={className}>
      <Checkbox
        id={id}
        checked={on}
        onCheckedChange={(c) => {
          setScanTimingsOn(c === true)
          setOn(c === true)
        }}
        className="mt-0.5"
      />
      <label htmlFor={id} className="space-y-0.5">
        <span className="block">Show scan timings</span>
        <span className="block text-muted-foreground">
          Where each frame&apos;s time goes, in ms, over the camera. For tracking down a slow scan.
        </span>
      </label>
    </div>
  )
}

const PARTS: [keyof FrameTiming, string][] = [
  ['grab', 'grab'],
  ['pixels', 'pixels'],
  ['vision', 'vision'],
  ['ocr', 'ocr'],
  ['wait', 'wait'],
  ['lookup', 'lookup'],
  ['outline', 'outline'],
  ['every', 'every']
]

/** The latest frames' median times, small, on the preview, under its top-left buttons. */
export function ScanTimingsReadout({ timing }: { timing: FrameTiming | null }): React.JSX.Element {
  return (
    <dl
      aria-label="Scan timings"
      className="pointer-events-none absolute left-2 top-[3.75rem] grid grid-cols-[auto_auto] gap-x-2 rounded-lg bg-black/60 px-2 py-1 font-mono text-[11px] leading-tight text-white"
    >
      {PARTS.map(([key, label]) => (
        <div key={key} className="contents">
          <dt className="text-white/60">{label}</dt>
          <dd className="text-right tabular-nums">{timing ? timing[key] : '–'}</dd>
        </div>
      ))}
    </dl>
  )
}
