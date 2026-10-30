import { findArtWindow, type DetectedArtWindow } from '@shared/artWindow'
import type { ArtImageRequest } from '@shared/ipc'
import { api } from './api'
import { cardImageSrc, printingImageSrc } from './images'

async function fetchBytes(src: string): Promise<Uint8Array | null> {
  const res = await fetch(src)
  return res.ok ? new Uint8Array(await res.arrayBuffer()) : null
}

/**
 * The desktop's `images:artBytes` on the page: the printing's scan from the portal if it has one,
 * else the card's art. Null when neither can be fetched.
 */
export async function pageArtBytes({
  imageId,
  printingId
}: ArtImageRequest): Promise<Uint8Array | null> {
  try {
    const scan = printingId == null ? null : printingImageSrc(printingId)
    const bytes = scan ? await fetchBytes(scan).catch(() => null) : null
    return bytes ?? (await fetchBytes(cardImageSrc('full', imageId)))
  } catch {
    return null
  }
}

/**
 * Looks for the artwork box in the image a panel shows. Decoded here rather than in the main
 * process because Pokémon art is WebP, which Electron's nativeImage can't read. Null when the
 * image can't be had or read, so the card's layout is used.
 */
export async function detectArtWindow(
  request: ArtImageRequest,
  roundedLeft: boolean
): Promise<DetectedArtWindow | null> {
  try {
    const bytes = await api.images.artBytes(request)
    if (!bytes) return null
    const bitmap = await createImageBitmap(new Blob([bytes.slice()]))
    const { width, height } = bitmap
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    ctx.drawImage(bitmap, 0, 0)
    bitmap.close()
    return findArtWindow(
      { data: ctx.getImageData(0, 0, width, height).data, width, height },
      { roundedLeft }
    )
  } catch {
    return null
  }
}
