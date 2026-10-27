import { isPhone, isWeb } from '@/lib/platform'

/** The only place image URLs are built: `ygo-img://` on desktop, the Worker's `/img/` on the web. */
const imageSrc = (path: string): string => (isWeb() ? `/img/${path}` : `ygo-img://${path}`)

/** `now` (desktop only): someone's waiting on it, so the app downloads it ahead of its queue. */
const now = (opts?: { now?: boolean }): string => (opts?.now && !isWeb() ? '?now' : '')

export const cardImageSrc = (
  size: 'small' | 'full' | 'cropped',
  imageId: number,
  opts?: { now?: boolean }
): string => imageSrc(`${size}/${imageId}`) + now(opts)
/** Null on the phone: its printing ids aren't the server's, so it has no printing scans. */
export const printingImageSrc = (printingId: number): string | null =>
  isPhone() ? null : imageSrc(`printing/${printingId}`)
export const setImageSrc = (key: string, opts?: { now?: boolean }): string =>
  imageSrc(`set/${key}`) + now(opts)
