import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { errorText } from './adminTabs'

/** A titled block of an admin tab, in the app's section style. */
export function Panel({
  title,
  className,
  children
}: {
  title: string
  className?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className={cn('rounded-lg border border-white/[0.06] bg-white/[0.02] p-4', className)}>
      <h2 className="mb-3 text-sm font-semibold">{title}</h2>
      {children}
    </section>
  )
}

export function Note({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <p className="text-[13px] text-muted-foreground">{children}</p>
}

/** A big number with its label, as the dashboard's header shows them. */
export function Tile({
  value,
  label,
  up
}: {
  value: string
  label: string
  up?: string
}): React.JSX.Element {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-4 py-3">
      <p className="text-3xl font-semibold tracking-tight">{value}</p>
      <p className="text-[13px] text-muted-foreground">{label}</p>
      {up && <p className="text-xs text-emerald-400">{up}</p>}
    </div>
  )
}

/** Label and value rows. */
export function Rows({ rows }: { rows: [string, string][] }): React.JSX.Element {
  return (
    <dl className="text-[13px]">
      {rows.map(([k, v]) => (
        <div
          key={k}
          className="flex justify-between gap-4 border-t border-white/[0.06] py-1.5 first:border-t-0"
        >
          <dt className="text-foreground/75">{k}</dt>
          <dd className="font-mono text-xs leading-5">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

/** A plain table: the first column left, the rest right-aligned, unless `left` says otherwise. */
export function Grid({
  heads,
  rows,
  left = 1
}: {
  heads: string[]
  rows: { key: string | number; cells: React.ReactNode[] }[]
  /** How many leading columns align left. */
  left?: number
}): React.JSX.Element {
  const align = (i: number): string => (i < left ? 'text-left' : 'text-right')
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead>
          <tr>
            {heads.map((h, i) => (
              <th
                key={i}
                className={cn(
                  'pb-1.5 text-xs font-medium text-muted-foreground [&+th]:pl-3',
                  align(i)
                )}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-t border-white/[0.06]">
              {r.cells.map((c, i) => (
                <td
                  key={i}
                  className={cn('py-1.5 [&+td]:pl-3', align(i), i >= left && 'font-mono text-xs')}
                >
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** A meter of `part` out of `whole`. */
export function Meter({
  part,
  tone = 'bg-primary'
}: {
  part: number
  tone?: string
}): React.JSX.Element {
  return (
    <div aria-hidden className="my-2 h-2 overflow-hidden rounded-[2px] bg-white/5">
      <div
        className={cn('h-full', tone)}
        style={{ width: `${Math.min(100, Math.max(0, part * 100)).toFixed(1)}%` }}
      />
    </div>
  )
}

export function Failed({ error }: { error: unknown }): React.JSX.Element {
  return (
    <p role="alert" className="text-[13px] text-destructive">
      {errorText(error)}
    </p>
  )
}

/**
 * A button that asks before it acts, in the app's dialog. `action` runs on confirm; when it
 * rejects, the dialog stays open with the message.
 */
export function ConfirmButton({
  label,
  title,
  description,
  confirmLabel = label,
  action
}: {
  label: string
  title: string
  description?: string
  confirmLabel?: string
  action: () => Promise<void>
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const close = (): void => {
    if (busy) return
    setOpen(false)
    setError(null)
  }
  const confirm = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await action()
      setOpen(false)
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <Button variant="outline" size="xs" onClick={() => setOpen(true)}>
        {label}
      </Button>
      <Dialog open={open} onOpenChange={(o) => !o && close()}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={close}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={busy} onClick={() => void confirm()}>
              {confirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
