import { isWeb } from '@/lib/platform'

/** The only place image URLs are built: `ygo-img://` on desktop, the Worker's `/img/` on the web. */
const imageSrc = (path: string): string => (isWeb() ? `/img/${path}` : `ygo-img://${path}`)

export const cardImageSrc = (size: 'small' | 'full' | 'cropped', imageId: number): string =>
  imageSrc(`${size}/${imageId}`)
export const printingImageSrc = (printingId: number): string => imageSrc(`printing/${printingId}`)
export const setImageSrc = (key: string): string => imageSrc(`set/${key}`)
