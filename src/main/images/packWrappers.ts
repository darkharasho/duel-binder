import { nativeImage } from 'electron'
import { promises as fs } from 'node:fs'
import type { PackWrappers } from '../../shared/rip/types'
import { findWrappers } from '../../shared/rip/wrappers'

/** `findWrappers` for a downloaded pack photo; null when it can't be read. */
export async function readPackWrappers(file: string): Promise<PackWrappers | null> {
  const image = nativeImage.createFromBuffer(await fs.readFile(file))
  if (image.isEmpty()) return null
  const { width, height } = image.getSize()
  return findWrappers({ data: image.toBitmap(), width, height })
}
