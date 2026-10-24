import { nativeImage } from 'electron'
import { promises as fs } from 'node:fs'
import { cutOutBackground } from './cutout'

/** Larger logos are scaled down first; tiles never show them anywhere near this big. */
const MAX_WIDTH = 1000
const MAX_HEIGHT = 600

/** Rewrites a downloaded logo (PNG or JPEG) as a PNG with its white background cut out. */
export async function prepareLogo(file: string): Promise<void> {
  let image = nativeImage.createFromBuffer(await fs.readFile(file))
  if (image.isEmpty()) throw new Error('unreadable logo')
  const size = image.getSize()
  const scale = Math.min(1, MAX_WIDTH / size.width, MAX_HEIGHT / size.height)
  if (scale < 1) {
    image = image.resize({
      width: Math.round(size.width * scale),
      height: Math.round(size.height * scale),
      quality: 'good'
    })
  }
  const { width, height } = image.getSize()
  const cut = cutOutBackground({ data: image.toBitmap(), width, height })
  if (!cut) throw new Error('blank logo')
  const out = nativeImage.createFromBitmap(Buffer.from(cut.data), {
    width: cut.width,
    height: cut.height
  })
  await fs.writeFile(file, out.toPNG())
}
