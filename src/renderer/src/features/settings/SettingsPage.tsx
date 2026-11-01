import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { isSyncing, useSyncStatus } from '@/components/useSyncStatus'
import { useUpdateStatus } from './useUpdateToasts'
import { api, queryKeys } from '@/lib/api'
import { formatRelative } from '@/lib/format'
import { useGame } from '@/lib/game'
import { isWeb } from '@/lib/platform'
import { AccountSection } from './AccountSection'
import { DexImportButton } from './DexImportDialog'
import { EbayPricesToggle } from './EbayPricesToggle'
import { UsageToggle } from './UsageToggle'
import { WishlistToggle } from './WishlistToggle'
import type { UpdateStatus } from '@shared/types'

function Section({
  title,
  children
}: {
  title: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className="border-t border-white/[0.08] pt-5">
      <h2 className="mb-3 text-sm font-semibold">{title}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right tabular-nums">{children}</span>
    </div>
  )
}

function describeUpdate(s: UpdateStatus | undefined): string {
  if (!s) return ''
  switch (s.state) {
    case 'checking':
      return 'Checking for updates…'
    case 'none':
      return "You're up to date"
    case 'available':
      return s.mode === 'notify'
        ? `Update ${s.version} available`
        : `Update ${s.version} found, downloading…`
    case 'downloading':
      return 'Downloading update…'
    case 'ready':
      return `Update ${s.version} ready to install`
    case 'error':
      return `Update check failed: ${s.error ?? 'unknown error'}`
    default:
      return ''
  }
}

function AboutSection(): React.JSX.Element {
  return (
    <Section title="About">
      <p className="text-sm text-muted-foreground">
        Non-English set lists from{' '}
        <a
          href="https://yugipedia.com/"
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-2 hover:text-foreground"
        >
          Yugipedia
        </a>{' '}
        (CC BY-SA 4.0).
      </p>
      <p className="text-sm text-muted-foreground">
        Pokémon booster pack images from the{' '}
        <a
          href="https://archives.bulbagarden.net/"
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-2 hover:text-foreground"
        >
          Bulbagarden Archives
        </a>{' '}
        and TCGplayer; set logos from TCGdex and the Pokémon TCG API. Pokémon images © The Pokémon
        Company.
      </p>
    </Section>
  )
}

const formatMb = (bytes: number): string => `${(bytes / (1024 * 1024)).toFixed(1)} MB`

function DesktopSettings(): React.JSX.Element {
  const qc = useQueryClient()
  const sync = useSyncStatus()
  const { available } = useGame()
  const version = useQuery({ queryKey: ['app', 'version'], queryFn: () => api.app.version() })
  const cache = useQuery({
    queryKey: ['images', 'cacheSize'],
    queryFn: () => api.images.cacheSize()
  })
  const update = useUpdateStatus()
  const setUpdate = (s: UpdateStatus): void => {
    qc.setQueryData(queryKeys.update, s)
  }

  const check = useMutation({
    mutationFn: () => api.app.checkForUpdates(),
    onSuccess: setUpdate,
    onError: (e: Error) =>
      setUpdate({ state: 'error', mode: update?.mode ?? 'auto', version: null, error: e.message })
  })
  const refresh = useMutation({
    mutationFn: () => api.sync.run(),
    onSuccess: (s) => qc.setQueryData(queryKeys.sync, s),
    onError: (e: Error) => toast.error(`Couldn't refresh card data: ${e.message}`)
  })
  const clear = useMutation({
    mutationFn: () => api.images.clearCache(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['images', 'cacheSize'] }),
    onError: (e: Error) => toast.error(`Couldn't clear image cache: ${e.message}`)
  })
  const backup = useMutation({
    mutationFn: () => api.app.backupDatabase(),
    onSuccess: (path) => {
      if (path) toast.success(`Backup saved to ${path}`)
    },
    onError: (e: Error) => toast.error(`Backup failed: ${e.message}`)
  })

  const syncing = isSyncing(sync) || refresh.isPending
  const lastSync = sync?.lastSyncAt ?? null

  return (
    <div className="max-w-2xl space-y-8 px-8 pb-10 pt-3">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>

      <Section title="Account">
        <AccountSection />
      </Section>

      <Section title="App">
        <Row label="Version">{version.data ?? '—'}</Row>
        <div className="flex items-center justify-between gap-4">
          <span role="status" className="text-sm text-muted-foreground">
            {describeUpdate(update)}
          </span>
          <div className="flex gap-2">
            {update?.mode === 'notify' && update.state === 'available' && (
              <Button size="sm" onClick={() => void api.app.applyUpdate()}>
                Download
              </Button>
            )}
            {update?.mode === 'auto' && update.state === 'ready' && (
              <Button size="sm" onClick={() => void api.app.applyUpdate()}>
                Restart now
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              disabled={check.isPending}
              onClick={() => check.mutate()}
            >
              Check for updates
            </Button>
          </div>
        </div>
      </Section>

      <Section title="Card data">
        <Row label="Last synced">
          {lastSync
            ? `${formatRelative(lastSync)} (${new Date(lastSync).toLocaleString()})`
            : 'never'}
        </Row>
        <Row label="Cards">{(sync?.cardCount ?? 0).toLocaleString('en-US')}</Row>
        <Row label="Database version">{sync?.dbVersion ?? '—'}</Row>
        {sync?.error && <p className="text-sm text-destructive">Last error: {sync.error}</p>}
        <Button size="sm" disabled={syncing} onClick={() => refresh.mutate()}>
          Refresh card data
        </Button>
      </Section>

      <Section title="Prices">
        <p className="text-sm text-muted-foreground">Prices come from your Duel Binder account.</p>
      </Section>

      <Section title="Image cache">
        <Row label="Size">{formatMb(cache.data ?? 0)}</Row>
        <Button
          variant="outline"
          size="sm"
          disabled={clear.isPending}
          onClick={() => clear.mutate()}
        >
          Clear image cache
        </Button>
      </Section>

      <Section title="Data">
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              api.app
                .openDataFolder()
                .catch((e: Error) => toast.error(`Couldn't open data folder: ${e.message}`))
            }
          >
            Open data folder
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={backup.isPending}
            onClick={() => backup.mutate()}
          >
            Back up collection…
          </Button>
          {available.includes('pkm') && !isWeb() && <DexImportButton />}
        </div>
      </Section>

      <Section title="Prices">
        <EbayPricesToggle />
      </Section>

      <Section title="Privacy">
        <WishlistToggle />
        <UsageToggle />
        <a
          href="https://duelbinder.com/privacy"
          target="_blank"
          rel="noreferrer"
          className="inline-block text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          Privacy policy
        </a>
      </Section>

      <AboutSection />
    </div>
  )
}

function WebSettings(): React.JSX.Element {
  return (
    <div className="max-w-2xl space-y-8 px-8 pb-10 pt-3">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      <Section title="Account">
        <AccountSection />
      </Section>
      <Section title="Privacy">
        <WishlistToggle />
        <UsageToggle />
        <a
          href="https://duelbinder.com/privacy"
          target="_blank"
          rel="noreferrer"
          className="inline-block text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          Privacy policy
        </a>
      </Section>

      <AboutSection />
    </div>
  )
}

export function SettingsPage(): React.JSX.Element {
  return isWeb() ? <WebSettings /> : <DesktopSettings />
}
