/**
 * The fatal message the data worker posts when the database is held by another copy of the app
 * (a second tab, or the page before a quick reload that hasn't let go yet).
 */
export const DB_OPEN_ELSEWHERE = 'open-elsewhere'

/** Waits between tries of the database open while another copy of the app holds it. */
export const OPEN_RETRY_DELAYS_MS = [250, 500, 1000, 2000]

/**
 * The OPFS SAH pool takes exclusive access handles on its files; while another page's worker holds
 * them, `createSyncAccessHandle` fails with NoModificationAllowedError ("Access Handles cannot be
 * created if there is another open Access Handle…").
 */
export function isOpenElsewhere(e: unknown): boolean {
  const { name, message } = (e ?? {}) as { name?: unknown; message?: unknown }
  return (
    name === 'NoModificationAllowedError' ||
    (typeof message === 'string' && /access handle/i.test(message))
  )
}

/**
 * Runs `open`, trying again after each of `delays` while the database is open elsewhere. Any other
 * failure, or the last one, is thrown.
 */
export async function openWithRetry<T>(
  open: () => Promise<T>,
  opts: { delays?: readonly number[]; sleep?: (ms: number) => Promise<void> } = {}
): Promise<T> {
  const delays = opts.delays ?? OPEN_RETRY_DELAYS_MS
  const sleep = opts.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)))
  for (let attempt = 0; ; attempt++) {
    try {
      return await open()
    } catch (e) {
      if (attempt >= delays.length || !isOpenElsewhere(e)) throw e
      await sleep(delays[attempt]!)
    }
  }
}
