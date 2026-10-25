const DEFAULT_PORTAL_URL = 'https://app.duelbinder.com'

/**
 * The portal the desktop signs in to and syncs with. Development builds may point at
 * another portal with `DUEL_BINDER_PORTAL_URL`; packaged builds always use the real one.
 */
export function portalUrl(env: Record<string, string | undefined>, packaged: boolean): string {
  const override = env.DUEL_BINDER_PORTAL_URL?.trim()
  if (!packaged && override) return override.replace(/\/+$/, '')
  return DEFAULT_PORTAL_URL
}
