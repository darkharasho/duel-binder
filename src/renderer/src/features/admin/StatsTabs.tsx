import type { AdminStats } from '@shared/admin'
import { FREE_STORAGE_BYTES, bytes, n } from './adminTabs'
import { Grid, Meter, Note, Panel, Rows, Tile } from './parts'

const PLATFORMS = ['desktop', 'web', 'phone', 'ios', 'android'] as const

function Database({ db }: { db: number | null }): React.JSX.Element {
  return (
    <Panel title="Database">
      {db == null ? (
        <Note>Size unknown.</Note>
      ) : (
        <>
          <Meter part={db / FREE_STORAGE_BYTES} />
          <Note>
            {bytes(db)} of the 5 GB free-plan limit ({((db / FREE_STORAGE_BYTES) * 100).toFixed(2)}
            %)
          </Note>
        </>
      )}
    </Panel>
  )
}

function Opens({ days }: { days: AdminStats['usage']['opensByDay'] }): React.JSX.Element {
  const max = Math.max(1, ...days.map((d) => d.count))
  return (
    <Panel title="App opens per day">
      {days.length === 0 ? (
        <Note>Nothing reported yet.</Note>
      ) : (
        <div className="flex h-56 items-end gap-[3px]" role="img" aria-label="App opens per day">
          {days.map((d) => (
            <div
              key={d.day}
              title={`${d.day}: ${n(d.count)} opens`}
              className="min-h-[2px] flex-1 rounded-t-[2px] bg-foreground/25 transition-colors hover:bg-foreground/60"
              style={{ height: `${Math.max(1, (d.count / max) * 100)}%` }}
            />
          ))}
        </div>
      )}
    </Panel>
  )
}

export function OverviewTab({
  stats,
  latestRuns
}: {
  stats: AdminStats
  latestRuns: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(10rem,1fr))] gap-3">
        <Tile
          value={n(stats.users.total)}
          label="users"
          up={`+${n(stats.users.new7d)} in 7 days`}
        />
        <Tile value={n(stats.active.day)} label="active today" />
        <Tile value={n(stats.active.week)} label="active this week" />
        <Tile value={n(stats.active.month)} label="active this month" />
        <Tile value={n(stats.collections.cards)} label="cards in collections" />
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Opens days={stats.usage.opensByDay} />
        <div className="grid content-start gap-4">
          {latestRuns}
          <Database db={stats.storage.databaseBytes} />
        </div>
      </div>
    </div>
  )
}

const PANELS = 'grid grid-cols-[repeat(auto-fit,minmax(18rem,1fr))] items-start gap-4'

export function UsersTab({ stats: s }: { stats: AdminStats }): React.JSX.Element {
  const sessions = Object.entries(s.sessions).map(([k, v]): [string, string] => [k, n(v)])
  return (
    <div className={PANELS}>
      <Panel title="Accounts">
        <Rows
          rows={[
            ['Discord', n(s.users.discord)],
            ['Apple', n(s.users.apple)],
            ['Email', n(s.users.email)],
            ['New in 7 days', n(s.users.new7d)],
            ['New in 30 days', n(s.users.new30d)]
          ]}
        />
      </Panel>
      <Panel title="Live sessions">
        <Rows rows={sessions.length ? sessions : [['none', '0']]} />
      </Panel>
      <Panel title="Collections">
        <Rows
          rows={[
            ['Collectors', n(s.collections.collectors)],
            ['Entries', n(s.collections.entries)],
            ['Cards', n(s.collections.cards)]
          ]}
        />
      </Panel>
      <Panel title="Friends">
        <Rows
          rows={[
            ['Friendships', n(s.friends.accepted)],
            ['Pending requests', n(s.friends.pending)],
            ['Blocks', n(s.friends.blocks)]
          ]}
        />
      </Panel>
      <Panel title="Largest collections">
        <Rows
          rows={
            s.collections.largest.length
              ? s.collections.largest.map((r): [string, string] => [
                  r.username,
                  `${n(r.entries)} entries · ${n(r.cards)} cards`
                ])
              : [['none yet', '']]
          }
        />
      </Panel>
    </div>
  )
}

export function UsageTab({ stats }: { stats: AdminStats }): React.JSX.Element {
  const byEvent = new Map<string, Partial<Record<string, number>>>()
  for (const t of stats.usage.totals) {
    const row = byEvent.get(t.event) ?? {}
    row[t.platform] = t.count
    byEvent.set(t.event, row)
  }
  return (
    <Panel title={`Events since ${stats.usage.since} (anonymous)`}>
      {byEvent.size === 0 ? (
        <Note>Nothing reported yet.</Note>
      ) : (
        <Grid
          heads={['Event', ...PLATFORMS, 'Total']}
          rows={[...byEvent].map(([event, row]) => ({
            key: event,
            cells: [
              event,
              ...PLATFORMS.map((p) => (row[p] ? n(row[p]) : '–')),
              n(PLATFORMS.reduce((sum, p) => sum + (row[p] ?? 0), 0))
            ]
          }))}
        />
      )}
    </Panel>
  )
}

export function ScannerTab({ stats: s }: { stats: AdminStats }): React.JSX.Element {
  return (
    <div className={PANELS}>
      <Panel title="Scanner">
        <Rows
          rows={[
            ['Scan contributions', n(s.scan.contributions)],
            ['… in 7 days', n(s.scan.contributions7d)]
          ]}
        />
      </Panel>
      <Panel title="eBay prices">
        <Rows
          rows={[
            ['Price requests today', n(s.priceRequests.today)],
            ['… in 7 days', n(s.priceRequests.last7d)],
            ['Sweep calls today', n(s.sweep.callsToday)],
            ['Sets swept in 7 days', n(s.sweep.sweptLast7d)],
            ['Sets in sweep queue', n(s.sweep.prefixes)]
          ]}
        />
      </Panel>
    </div>
  )
}

export function StorageTab({ stats }: { stats: AdminStats }): React.JSX.Element {
  return (
    <div className="grid max-w-2xl gap-4">
      <Database db={stats.storage.databaseBytes} />
      <Panel title="Rows by table">
        <Rows
          rows={Object.entries(stats.storage.rows).map(([k, v]): [string, string] => [
            k,
            `${n(v)} rows`
          ])}
        />
      </Panel>
    </div>
  )
}
