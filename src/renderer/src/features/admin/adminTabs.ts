/** Every admin page tab, in the portal dashboard's order. */
export const ADMIN_PAGE_TABS = [
  { value: 'overview', label: 'Overview' },
  { value: 'runs', label: 'Runs' },
  { value: 'people', label: 'Users' },
  { value: 'activity', label: 'Usage' },
  { value: 'errors', label: 'Errors' },
  { value: 'scanner', label: 'Scanner & prices' },
  { value: 'storage', label: 'Storage' },
  { value: 'merges', label: 'Merges' },
  { value: 'testers', label: 'Testers' },
  { value: 'admins', label: 'Admins' },
  { value: 'photos', label: 'Photos' }
] as const satisfies readonly { value: string; label: string }[]

export type AdminPageTab = (typeof ADMIN_PAGE_TABS)[number]['value']

/** The admin queries' keys; a Refresh drops them all. Nothing re-reads on its own. */
export const adminKeys = {
  all: ['admin'] as const,
  stats: ['admin', 'stats'] as const,
  errors: ['admin', 'errors'] as const,
  runs: ['admin', 'runs'] as const,
  merges: ['admin', 'merges'] as const,
  testers: ['admin', 'testers'] as const,
  admins: ['admin', 'admins'] as const,
  photos: ['admin', 'photos'] as const
}

/** Admin reads cost portal row reads, so they're read once and kept until a Refresh. */
export const ADMIN_QUERY = {
  staleTime: Infinity,
  gcTime: 30 * 60 * 1000,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
  retry: false
} as const

export const n = (v: number | null | undefined): string => (v ?? 0).toLocaleString()

export function bytes(b: number | null): string {
  if (b == null) return 'unknown'
  if (b < 1e6) return `${(b / 1e3).toFixed(1)} KB`
  if (b < 1e9) return `${(b / 1e6).toFixed(1)} MB`
  return `${(b / 1e9).toFixed(2)} GB`
}

/** Free-plan SQLite storage for the whole Cloudflare account (Durable Objects, Workers Free). */
export const FREE_STORAGE_BYTES = 5 * 1000 ** 3

export const shortWhen = (iso: string): string =>
  new Date(iso).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })

/** An error's message without Electron's IPC prefix; the portal's 404 means not an admin. */
export function errorText(e: unknown): string {
  const m = (e instanceof Error ? e.message : String(e)).replace(
    /^Error invoking remote method '[^']*': (Error: )?/,
    ''
  )
  return m === 'Not found' ? 'This account is not an admin.' : m
}
