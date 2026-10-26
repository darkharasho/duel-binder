import { existsSync } from 'fs'
import { createRequire } from 'module'
import { dirname, join } from 'path'
import { createWorker, OEM, PSM, type Worker } from 'tesseract.js'
import type { OcrBand } from '@shared/scan/types'

const CODE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-'

export interface Ocr {
  /** The text on each band, one line per band, in order. */
  read(bands: OcrBand[], kind: 'code' | 'name'): Promise<string[]>
  dispose(): Promise<void>
}

/**
 * The folder of the installed `@tesseract.js-data/eng` model, `best_int` when it ships one. Packaged,
 * it's the copy electron-builder unpacks next to the asar, since tesseract reads it from disk.
 */
export function engLangPath(packaged = false): string {
  const root = packaged
    ? join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', '@tesseract.js-data', 'eng')
    : dirname(createRequire(import.meta.url).resolve('@tesseract.js-data/eng/package.json'))
  const bestInt = join(root, '4.0.0_best_int')
  return existsSync(bestInt) ? bestInt : join(root, '4.0.0')
}

/** A grayscale band as a binary PGM, which Leptonica reads without any codec. */
function toPgm(band: OcrBand): Buffer {
  const header = Buffer.from(`P5\n${band.width} ${band.height}\n255\n`, 'ascii')
  return Buffer.concat([
    header,
    Buffer.from(band.data.buffer, band.data.byteOffset, band.width * band.height)
  ])
}

/**
 * Local OCR for the Scan page, with one tesseract worker created on first use. Everything is read
 * from disk: the language data from langPath and the core from the installed `tesseract.js-core`.
 */
export function createOcr(opts: { langPath?: string } = {}): Ocr {
  let worker: Promise<Worker> | null = null
  // One worker and its parameters are shared, so reads run one at a time.
  let queue: Promise<unknown> = Promise.resolve()

  const getWorker = (): Promise<Worker> =>
    (worker ??= createWorker('eng', OEM.LSTM_ONLY, {
      langPath: opts.langPath ?? engLangPath(),
      // Don't write a traineddata copy into the working directory.
      cacheMethod: 'none',
      gzip: true
    }).catch((err: unknown) => {
      // Let the next read try again.
      worker = null
      throw err
    }))

  const run = async (bands: OcrBand[], kind: 'code' | 'name'): Promise<string[]> => {
    const w = await getWorker()
    await w.setParameters({
      tessedit_pageseg_mode: PSM.SINGLE_LINE,
      tessedit_char_whitelist: kind === 'code' ? CODE_CHARS : ''
    })
    const out: string[] = []
    for (const band of bands) {
      if (!band.width || !band.height) {
        out.push('')
        continue
      }
      const { data } = await w.recognize(toPgm(band))
      out.push(data.text.trim())
    }
    return out
  }

  return {
    read(bands, kind) {
      const result = queue.then(() => run(bands, kind))
      queue = result.catch(() => {})
      return result
    },
    async dispose() {
      const w = worker
      worker = null
      if (w) await (await w).terminate()
    }
  }
}
