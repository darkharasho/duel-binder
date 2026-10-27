/**
 * Loads these images, resolving once all have loaded or failed, or after `timeoutMs` (offline, or
 * a slow server, mustn't hold the pack shut for long). Never rejects.
 */
export function loadArt(srcs: string[], timeoutMs: number): Promise<void> {
  const each = srcs.map(
    (src) =>
      new Promise<void>((resolve) => {
        const img = new Image()
        img.onload = img.onerror = () => resolve()
        img.src = src
      })
  )
  return Promise.race([
    Promise.all(each).then(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs))
  ])
}
