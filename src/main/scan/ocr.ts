import { existsSync } from 'fs'
import { createRequire } from 'module'
import { dirname, join } from 'path'
import type { Worker as NodeWorker } from 'worker_threads'
import { createWorker, OEM } from 'tesseract.js'
import { createOcrQueue, type Ocr, type OcrModel, type OcrWorker } from '@shared/scan/ocr'

export { checkOcrBands } from '@shared/scan/ocr'
export type { Ocr, OcrModel } from '@shared/scan/ocr'

/**
 * The folder of the installed `@tesseract.js-data/<model>` model, `best_int` when it ships one.
 * Packaged, it's the copy electron-builder unpacks next to the asar, since tesseract reads it from
 * disk.
 */
export function langPath(model: OcrModel, packaged = false): string {
  const root = packaged
    ? join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', '@tesseract.js-data', model)
    : dirname(createRequire(import.meta.url).resolve(`@tesseract.js-data/${model}/package.json`))
  const bestInt = join(root, '4.0.0_best_int')
  return existsSync(bestInt) ? bestInt : join(root, '4.0.0')
}

export const engLangPath = (packaged = false): string => langPath('eng', packaged)

/**
 * Local OCR for the Scan page, with one tesseract worker per model, each created on first use.
 * Everything is read from disk: the language data from the installed `@tesseract.js-data` models
 * and the core from the installed `tesseract.js-core`.
 */
export function createOcr(opts: { packaged?: boolean; timeoutMs?: number } = {}): Ocr {
  let warned = false
  return createOcrQueue({
    timeoutMs: opts.timeoutMs,
    async start(model: OcrModel, onDead: () => void): Promise<OcrWorker> {
      const w = await createWorker(model, OEM.LSTM_ONLY, {
        langPath: langPath(model, opts.packaged),
        // Don't write a traineddata copy into the working directory.
        cacheMethod: 'none',
        gzip: true,
        // Without a handler, tesseract.js rethrows a failed job as an uncaught exception; the
        // job's promise rejects either way.
        errorHandler: (err: unknown) => {
          if (!warned) console.warn('OCR job failed:', err)
          warned = true
        }
      })
      // The thread behind the worker; if it dies, start over on the next read.
      const thread = (w as unknown as { worker: NodeWorker }).worker
      thread.on('error', onDead)
      thread.on('exit', onDead)
      return w as unknown as OcrWorker
    }
  })
}
