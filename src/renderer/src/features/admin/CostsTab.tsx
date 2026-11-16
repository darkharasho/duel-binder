import type { AdminCosts } from '@shared/costs'
import { Button } from '@/components/ui/button'
import { bytes, n } from './adminTabs'
import { Grid, Note, Panel, Tile } from './parts'

/** 1,234 → 1.2K, 3,400,000,000 → 3.4B. */
function big(v: number): string {
  const a = Math.abs(v)
  if (a >= 1e9) return `${(v / 1e9).toFixed(1)}B`
  if (a >= 1e6) return `${(v / 1e6).toFixed(1)}M`
  if (a >= 1e4) return `${(v / 1e3).toFixed(1)}K`
  return Math.round(v).toLocaleString()
}

const dollars = (v: number): string => `$${v < 10 ? v.toFixed(2) : Math.round(v).toLocaleString()}`

const PANELS = 'grid grid-cols-[repeat(auto-fit,minmax(24rem,1fr))] items-start gap-6'

/**
 * The portal's Costs tab: what requests cost the Durable Object (rows read and written, time),
 * per signed-in user and per area, and the monthly Cloudflare bill that projects to.
 */
export function CostsTab({
  costs: c,
  days,
  onDays
}: {
  costs: AdminCosts
  days: 7 | 30
  onDays: (days: 7 | 30) => void
}): React.JSX.Element {
  const u = c.perUserMonth
  const lines = c.projections[0]?.lines ?? []
  const max = Math.max(1, ...c.byDay.map((d) => d.rowsRead))
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        {([7, 30] as const).map((d) => (
          <Button
            key={d}
            size="sm"
            variant={d === days ? 'secondary' : 'outline'}
            aria-pressed={d === days}
            onClick={() => onDays(d)}
          >
            Last {d} days
          </Button>
        ))}
        <span className="text-xs text-muted-foreground">
          Since {c.since} · {c.days} day{c.days === 1 ? '' : 's'} measured
        </span>
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(10rem,1fr))] gap-3">
        <Tile value={n(c.activeUsers)} label="signed-in users measured" />
        <Tile value={u ? big(u.requests) : '–'} label="requests per user a month" />
        <Tile value={u ? big(u.rowsRead) : '–'} label="rows read per user a month" />
        <Tile value={u ? big(u.rowsWritten) : '–'} label="rows written per user a month" />
        <Tile value={big(c.systemMonth.rowsRead)} label="system rows read a month" />
      </div>
      <Panel title="Projected monthly bill (Cloudflare)">
        <Grid
          heads={[
            'Users',
            ...c.projections.map((p) => `${n(p.users)}${p.users === c.activeUsers ? ' (now)' : ''}`)
          ]}
          rows={[
            ...lines.map((l, i) => ({
              key: l.item,
              cells: [l.item, ...c.projections.map((p) => dollars(p.lines[i].dollars))]
            })),
            { key: 'total', cells: ['Total', ...c.projections.map((p) => dollars(p.dollars))] }
          ]}
        />
        <div className="mt-2">
          <Note>
            Each user is today’s average signed-in user; system work (catalog uploads, the price
            alarm, signed-out images) stays as measured. Worker requests that never reach the
            database (edge-cached art, the site) and fixed fees (Apple, signing) aren’t included.
            Storage is today’s {bytes(c.storageBytes)}.
          </Note>
        </div>
      </Panel>
      <div className={PANELS}>
        <Panel title="By area">
          {c.byArea.length === 0 ? (
            <Note>Nothing measured yet.</Note>
          ) : (
            <Grid
              heads={['Area', 'Requests', 'Rows read', 'Rows written', 'Time']}
              rows={c.byArea.map((a) => ({
                key: a.area,
                cells: [
                  a.area,
                  big(a.requests),
                  big(a.rowsRead),
                  big(a.rowsWritten),
                  `${big(a.ms / 1000)} s`
                ]
              }))}
            />
          )}
        </Panel>
        <Panel title="By user">
          <Grid
            heads={['User', 'Requests', 'Rows read', 'Rows written']}
            rows={[
              ...c.byUser.map((x) => ({
                key: x.userId,
                cells: [`@${x.username}`, big(x.requests), big(x.rowsRead), big(x.rowsWritten)]
              })),
              {
                key: 'system',
                cells: [
                  '(no user: system)',
                  big(c.system.requests),
                  big(c.system.rowsRead),
                  big(c.system.rowsWritten)
                ]
              }
            ]}
          />
        </Panel>
      </div>
      <Panel title="Rows read per day">
        {c.byDay.length === 0 ? (
          <Note>Nothing measured yet.</Note>
        ) : (
          <div className="flex h-40 items-end gap-[3px]" role="img" aria-label="Rows read per day">
            {c.byDay.map((d) => (
              <div
                key={d.day}
                title={`${d.day}: ${big(d.rowsRead)} read, ${big(d.rowsWritten)} written, ${big(d.requests)} requests`}
                className="min-h-[2px] flex-1 rounded-t-[2px] bg-foreground/25 transition-colors hover:bg-foreground/60"
                style={{ height: `${Math.max(1, (d.rowsRead / max) * 100)}%` }}
              />
            ))}
          </div>
        )}
      </Panel>
    </div>
  )
}
