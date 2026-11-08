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
/** `small`: the photo's small copy, for a grid tile; the full view asks for the full photo. */
const photoPath = (id: number, opts?: { small?: boolean }): string =>
  opts?.small ? `printing-small/${id}` : `printing/${id}`
/**
 * Null on the phone: its printing ids aren't the server's. There a printing's photo is found by
 * the server's id instead (usePrintingPhotoSrc in printingPhotos.ts, then printingPhotoSrc).
 */
export const printingImageSrc = (printingId: number, opts?: { small?: boolean }): string | null =>
  isPhone() ? null : imageSrc(photoPath(printingId, opts))
/** A printing's photo by the server's printing id: the phone's way to it. */
export const printingPhotoSrc = (serverId: number, opts?: { small?: boolean }): string =>
  imageSrc(photoPath(serverId, opts))
/** A Pokédex sprite by national number. */
export const spriteSrc = (n: number): string => imageSrc(`sprite/${n}`)
export const setImageSrc = (key: string, opts?: { now?: boolean }): string =>
  imageSrc(`set/${key}`) + now(opts)
