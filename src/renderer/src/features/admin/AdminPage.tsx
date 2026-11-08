import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { UnderlineTabs } from '@/components/UnderlineTabs'
import { api } from '@/lib/api'
import { ADMIN_PAGE_TABS, ADMIN_QUERY, adminKeys, type AdminPageTab } from './adminTabs'
import { AdminsTab, ErrorsTab, MergesTab, PhotosTab, TestersTab } from './ListTabs'
import { Failed } from './parts'
import { POLL_MS, loadRuns } from './runs'
import { LatestRuns, Pulse, RunsTab } from './RunsTab'
import { OverviewTab, ScannerTab, StorageTab, UsageTab, UsersTab } from './StatsTabs'

const STATS_TABS: readonly AdminPageTab[] = ['overview', 'people', 'activity', 'scanner', 'storage']

function admin(): NonNullable<typeof api.admin> {
  if (!api.admin) throw new Error('Admin pages are desktop only')
  return api.admin
}

/** A query's body: its error, nothing while it loads, or `show` with its data. */
function Show<T>({
  q,
  show
}: {
  q: UseQueryResult<T>
  show: (data: T) => React.ReactNode
}): React.JSX.Element | null {
  if (q.isError) return <Failed error={q.error} />
  if (!q.isSuccess) return <p className="text-[13px] text-muted-foreground">Loading…</p>
  return <>{show(q.data)}</>
}

/**
 * The admin pages, in the app (desktop only): the portal dashboard's tabs, read with the signed-in
 * admin account. Each read happens once, when its tab first shows, and is kept until Refresh: the
 * stats read counts every table, and free-plan row reads are capped daily. Switching tabs reads
 * nothing new; the stats tabs share the one read.
 */
export function AdminPage({
  tab,
  onTab,
  onLeave
}: {
  tab: AdminPageTab
  onTab: (tab: AdminPageTab) => void
  /** After the account removes itself from admins. */
  onLeave: () => void
}): React.JSX.Element {
  const qc = useQueryClient()
  const needsStats = STATS_TABS.includes(tab)
  const stats = useQuery({
    queryKey: adminKeys.stats,
    queryFn: () => admin().stats(),
    enabled: needsStats,
    ...ADMIN_QUERY
  })
  // The header's pulse shows on every tab, so the runs read always happens.
  const runs = useQuery({
    queryKey: adminKeys.runs,
    queryFn: () => loadRuns(admin()),
    ...ADMIN_QUERY,
    refetchInterval: (q) => (q.state.data?.live ? POLL_MS : false)
  })
  const errors = useQuery({
    queryKey: adminKeys.errors,
    queryFn: () => admin().errors(),
    enabled: tab === 'errors',
    ...ADMIN_QUERY
  })
  const merges = useQuery({
    queryKey: adminKeys.merges,
    queryFn: () => admin().merges(),
    enabled: tab === 'merges',
    ...ADMIN_QUERY
  })
  const testers = useQuery({
    queryKey: adminKeys.testers,
    queryFn: () => admin().testers(),
    enabled: tab === 'testers',
    ...ADMIN_QUERY
  })
  const admins = useQuery({
    queryKey: adminKeys.admins,
    queryFn: () => admin().admins(),
    enabled: tab === 'admins',
    ...ADMIN_QUERY
  })
  const photos = useQuery({
    queryKey: adminKeys.photos,
    queryFn: () => admin().photos(),
    enabled: tab === 'photos',
    ...ADMIN_QUERY
  })
  const fetching = [stats, runs, errors, merges, testers, admins, photos].some((q) => q.isFetching)
  // Only what's been read is read again; tabs not yet opened stay unread.
  const refresh = (): void => void qc.invalidateQueries({ queryKey: adminKeys.all })

  return (
    <div className="space-y-5 p-8 max-md:p-4">
      <PageHeader>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <h1 className="text-xl font-semibold">Admin</h1>
          <Pulse view={runs.data} />
          <span className="flex-1" />
          {needsStats && stats.data && (
            <span className="text-xs text-muted-foreground">
              Updated {new Date(stats.data.at).toLocaleString()}
            </span>
          )}
          <Button variant="outline" size="sm" disabled={fetching} onClick={refresh}>
            Refresh
          </Button>
        </div>
        <UnderlineTabs
          label="Admin sections"
          value={tab}
          options={ADMIN_PAGE_TABS}
          onChange={onTab}
          className="mt-3 flex-wrap gap-y-2 border-b border-white/[0.06]"
        />
      </PageHeader>
      {needsStats && (
        <Show
          q={stats}
          show={(s) =>
            tab === 'overview' ? (
              <OverviewTab stats={s} latestRuns={<LatestRuns view={runs.data} />} />
            ) : tab === 'people' ? (
              <UsersTab stats={s} />
            ) : tab === 'activity' ? (
              <UsageTab stats={s} />
            ) : tab === 'scanner' ? (
              <ScannerTab stats={s} />
            ) : (
              <StorageTab stats={s} />
            )
          }
        />
      )}
      {tab === 'runs' && <Show q={runs} show={(v) => <RunsTab view={v} />} />}
      {tab === 'errors' && <Show q={errors} show={(g) => <ErrorsTab groups={g} />} />}
      {tab === 'merges' && <Show q={merges} show={(m) => <MergesTab merges={m} />} />}
      {tab === 'testers' && <Show q={testers} show={(t) => <TestersTab testers={t} />} />}
      {tab === 'admins' && (
        <Show
          q={admins}
          show={(l) => (
            <AdminsTab
              list={l}
              onRemovedSelf={() => {
                qc.removeQueries({ queryKey: adminKeys.all })
                onLeave()
              }}
            />
          )}
        />
      )}
      {tab === 'photos' && <Show q={photos} show={(p) => <PhotosTab photos={p} />} />}
    </div>
  )
}
