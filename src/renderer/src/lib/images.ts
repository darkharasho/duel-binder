import { isPhone, isWeb } from '@/lib/platform'
import { PORTAL_ORIGIN } from '@/lib/portal'

/** The only place image URLs are built: `ygo-img://` on desktop, the Worker's `/img/` on the web. */
const imageSrc = (path: string): string =>
  isWeb() ? `${PORTAL_ORIGIN}/img/${path}` : `ygo-img://${path}`

/** `now` (desktop only): someone's waiting on it, so the app downloads it ahead of its queue. */
const now = (opts?: { now?: boolean }): string => (opts?.now && !isWeb() ? '?now' : '')

export const cardImageSrc = (
  size: 'small' | 'full' | 'cropped',
  imageId: number,
  opts?: { now?: boolean }
): string => imageSrc(`${size}/${imageId}`) + now(opts)
/**
 * Null on the phone: its printing ids aren't the server's. There a printing's photo is found by
 * the server's id instead (usePrintingPhotoSrc in printingPhotos.ts, then printingPhotoSrc).
 */
export const printingImageSrc = (printingId: number): string | null =>
  isPhone() ? null : imageSrc(`printing/${printingId}`)
/** A printing's photo by the server's printing id: the phone's way to it. */
export const printingPhotoSrc = (serverId: number): string => imageSrc(`printing/${serverId}`)
export const setImageSrc = (key: string, opts?: { now?: boolean }): string =>
  imageSrc(`set/${key}`) + now(opts)
