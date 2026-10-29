import { setImageSrc } from '../renderer/src/lib/images'
import type { PackWrappers } from '../shared/rip/types'
import { findWrappers } from '../shared/rip/wrappers'

/**
 * The desktop's `rip:packWrappers` on the page: the pack photo from the portal, decoded on a
 * canvas. Null when it can't be fetched or read, so the pack shows the whole photo.
 */
export async function phonePackWrappers(key: string): Promise<PackWrappers | null> {
  if (typeof key !== 'string') throw new Error('Pack image key must be a string')
  try {
    const res = await fetch(setImageSrc(key))
    if (!res.ok) return null
    const bitmap = await createImageBitmap(await res.blob())
    const { width, height } = bitmap
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    ctx.drawImage(bitmap, 0, 0)
    bitmap.close()
    return findWrappers({ data: ctx.getImageData(0, 0, width, height).data, width, height })
  } catch {
    return null
  }
}
