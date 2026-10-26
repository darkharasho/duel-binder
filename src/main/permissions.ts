import type { Session } from 'electron'

/** True for the app's own pages: the dev server's origin in dev, else the bundled file:// pages. */
export function isAppUrl(url: string, devUrl: string | undefined): boolean {
  try {
    const u = new URL(url)
    if (devUrl) return u.origin === new URL(devUrl).origin
    return u.protocol === 'file:'
  } catch {
    return false
  }
}

/**
 * Grants the camera (`media`, video only) to the app's own pages and denies every other
 * permission, and every permission to anything else. Scan's webcam preview is the only user.
 */
export function restrictPermissions(
  session: Pick<Session, 'setPermissionRequestHandler' | 'setPermissionCheckHandler'>,
  devUrl: string | undefined
): void {
  session.setPermissionRequestHandler((_wc, permission, callback, details) => {
    const types = 'mediaTypes' in details ? (details.mediaTypes ?? []) : []
    callback(
      permission === 'media' && !types.includes('audio') && isAppUrl(details.requestingUrl, devUrl)
    )
  })
  session.setPermissionCheckHandler((_wc, permission, requestingOrigin, details) => {
    const type = 'mediaType' in details ? details.mediaType : undefined
    return permission === 'media' && type !== 'audio' && isAppUrl(requestingOrigin, devUrl)
  })
}
