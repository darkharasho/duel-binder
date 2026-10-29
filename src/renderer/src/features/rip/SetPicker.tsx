import { useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Minus, Plus, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api, queryKeys } from '@/lib/api'
import { formatMonthYear } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { RipSet } from '../../../../shared/rip/types'
import { SetArt } from '../sets/SetArt'

const MAX_PACKS = 100
const QUICK_PICKS = [
  { count: 1, label: '1' },
  { count: 5, label: '5' },
  { count: 24, label: '24 (box)' }
] as const

/** A pack count main will accept: non-finite becomes 1, otherwise rounded and held to 1-100. */
// eslint-disable-next-line react-refresh/only-export-components -- the helper belongs with its picker
export function clampPackCount(n: number): number {
  if (!Number.isFinite(n)) return 1
  return Math.min(MAX_PACKS, Math.max(1, Math.round(n)))
}

interface Props {
  /** Starts the session; a rejection is shown under the Rip button. */
  onRip: (set: RipSet, packCount: number) => void | Promise<void>
  /** The set that was selected last time, so coming back from an opening keeps it. */
  initialSetName?: string | null
}

export function SetPicker({ onRip, initialSetName = null }: Props): React.JSX.Element {
  const sets = useQuery({ queryKey: queryKeys.ripSets, queryFn: () => api.rip.sets() })
  const [q, setQ] = useState('')
  const [selectedName, setSelectedName] = useState<string | null>(initialSetName)
  const [text, setText] = useState('1')
  const [starting, setStarting] = useState(false)
  // State lags a same-tick double click; the ref doesn't.
  const inFlight = useRef(false)
  const [error, setError] = useState<string | null>(null)

  const all = sets.data
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!all) return []
    if (!needle) return all
    return all.filter(
      (s) => s.setName.toLowerCase().includes(needle) || s.setCode.toLowerCase().includes(needle)
    )
  }, [all, q])
  const selected = all?.find((s) => s.setName === selectedName) ?? null
  const count = clampPackCount(Number(text))

  const setCount = (n: number): void => setText(String(clampPackCount(n)))

  const rip = async (): Promise<void> => {
    if (!selected || inFlight.current) return
    inFlight.current = true
    const n = clampPackCount(Number(text))
    setText(String(n))
    setStarting(true)
    setError(null)
    try {
      await onRip(selected, n)
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : 'Could not start the session.')
      inFlight.current = false
      setStarting(false)
    }
  }

  if (sets.isPending) return <p className="text-sm text-muted-foreground">Loading sets…</p>
  if (sets.isError) {
    return (
      <div className="space-y-2 text-sm">
        <p>Couldn&apos;t load sets.</p>
        <Button variant="outline" size="sm" onClick={() => void sets.refetch()}>
          Try again
        </Button>
      </div>
    )
  }
  if (all && all.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No sets to rip yet. The card catalog may still be syncing; check back in a moment.
      </p>
    )
  }

  return (
    <div className="space-y-5">
      <div className="relative w-72 max-md:w-full">
        <Search
          aria-hidden
          className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search sets by name or code"
          aria-label="Search sets"
          className="pl-8"
        />
      </div>

      {shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">No sets match &ldquo;{q}&rdquo;.</p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-x-5 gap-y-7 max-md:grid-cols-2 max-md:gap-x-3">
          {shown.map((s) => (
            <button
              key={s.setName}
              type="button"
              aria-pressed={s.setName === selectedName}
              onClick={() => {
                setSelectedName(s.setName)
                setError(null)
              }}
              className="group flex w-full flex-col gap-2.5 rounded-md text-left focus-visible:outline-2 focus-visible:outline-ring"
            >
              <SetArt
                imageKey={s.imageKey}
                packImageKey={s.packImageKey}
                logoImageKey={s.logoImageKey}
                coverImageId={s.coverImageId}
                setCode={s.setCode}
                className={cn(
                  'aspect-[4/3] w-full rounded-[4px] shadow-[0_8px_20px_rgb(0_0_0/0.45)] transition-transform duration-200 group-hover:-translate-y-1',
                  s.setName === selectedName && 'ring-2 ring-foreground'
                )}
              />
              <div className="min-w-0 space-y-0.5">
                <span title={s.setName} className="line-clamp-2 text-sm/5 font-semibold">
                  {s.setName}
                </span>
                <p className="text-xs text-muted-foreground">
                  {s.setCode}
                  {s.tcgDate ? ` · ${formatMonthYear(s.tcgDate)}` : ''}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}
      {selected && (
        <div className="sticky bottom-4 z-10 flex flex-wrap items-center gap-x-6 gap-y-3 rounded-md border border-white/[0.08] bg-card/95 p-4 shadow-[0_8px_30px_rgb(0_0_0/0.6)] backdrop-blur">
          <div className="min-w-0 flex-1 max-md:basis-full">
            <p className="truncate text-base font-semibold">{selected.setName}</p>
            <p title={selected.layoutLabel} className="text-[13px] text-muted-foreground">
              {selected.packLine}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {QUICK_PICKS.map((p) => (
              <Button
                key={p.count}
                type="button"
                size="sm"
                variant={count === p.count ? 'secondary' : 'outline'}
                onClick={() => setCount(p.count)}
              >
                {p.label}
              </Button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              size="icon"
              variant="outline"
              aria-label="Fewer packs"
              disabled={count <= 1}
              onClick={() => setCount(count - 1)}
            >
              <Minus />
            </Button>
            <Input
              type="number"
              inputMode="numeric"
              aria-label="Packs"
              min={1}
              max={MAX_PACKS}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onBlur={() => setCount(Number(text))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') setCount(Number(text))
              }}
              className="w-16 text-center"
            />
            <Button
              type="button"
              size="icon"
              variant="outline"
              aria-label="More packs"
              disabled={count >= MAX_PACKS}
              onClick={() => setCount(count + 1)}
            >
              <Plus />
            </Button>
          </div>
          <Button
            type="button"
            disabled={starting}
            onClick={() => void rip()}
            className="max-md:flex-1"
          >
            {count === 1 ? 'Rip 1 pack' : `Rip ${count} packs`}
          </Button>
          {error && (
            <p role="alert" className="basis-full text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
