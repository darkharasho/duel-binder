// A static import on purpose: the Emscripten module has its own `then`, so `await import()` of it
// (or of a bundler namespace that copies its keys) would chase it forever.
import cvModule, { type CV } from '@techstark/opencv-js'

export type { CV }

type CvModule = CV & { then?: unknown; onRuntimeInitialized?: () => void }

let loading: Promise<CV> | null = null

async function init(): Promise<CV> {
  const cv = cvModule as unknown as CvModule
  // Its classes appear once the WebAssembly runtime is up.
  if (!('Mat' in (cv as object))) {
    await new Promise<void>((resolve) => {
      cv.onRuntimeInitialized = resolve
    })
  }
  // Returning a thenable from an async function would chase `then` too.
  delete cv.then
  return cv
}

/** The OpenCV.js runtime, initialized once. Works in a browser, a Web Worker or Node. */
export function loadCv(): Promise<CV> {
  loading ??= init()
  return loading
}
