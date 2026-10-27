import { createWorker, OEM } from 'tesseract.js'
import { createOcrQueue, type Ocr, type OcrModel, type OcrWorker } from '../shared/scan/ocr'

/**
 * OCR in the browser, with one tesseract Web Worker per model, created on first use. The worker
 * script, the core and the language data are the app's own files under `base` (no CDN). The
 * browser keeps each language's data in IndexedDB, so a non-English model downloads only the
 * first time it is needed.
 */
export function createBrowserOcr(base: string): Ocr {
  let warned = false
  return createOcrQueue({
    async start(model: OcrModel, onDead: () => void): Promise<OcrWorker> {
      const w = await createWorker(model, OEM.LSTM_ONLY, {
        workerPath: base + 'ocr/worker.min.js',
        corePath: base + 'ocr/core/',
        langPath: base + 'ocr/lang/',
        workerBlobURL: false,
        gzip: true,
        cacheMethod: 'write',
        // Without a handler, tesseract.js rethrows a failed job as an uncaught exception; the
        // job's promise rejects either way.
        errorHandler: (err: unknown) => {
          if (!warned) console.warn('OCR job failed:', err)
          warned = true
        }
      })
      // The Web Worker behind it; if it dies, start over on the next read.
      ;(w as unknown as { worker: Worker }).worker.addEventListener('error', onDead)
      return w as unknown as OcrWorker
    }
  })
}
