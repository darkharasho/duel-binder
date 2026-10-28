import { SCAN_WINDOW_MESSAGE, SCAN_WINDOW_OPEN } from '@shared/ipc'
import { isFromScanWindow, isToScanWindow } from '@shared/scanWindow'

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** The BrowserWindow surface used here; a fake in tests. */
export interface ScanWindowLike {
  webContents: {
    id: number
    send(channel: string, payload: unknown): void
    reload(): void
    on(
      event: 'render-process-gone',
      cb: (event: unknown, details: { reason: string }) => void
    ): unknown
  }
  isDestroyed(): boolean
  isMinimized(): boolean
  restore(): void
  focus(): void
  close(): void
  isFullScreen(): boolean
  setFullScreen(on: boolean): void
  getNormalBounds(): Rect
  on(event: 'closed' | 'close', cb: () => void): void
}

const MIN_OVERLAP = 100
/** A scan window that crashes again this soon after a reload is closed rather than reloaded. */
const CRASH_LOOP_MS = 60_000

const isRect = (v: unknown): v is Rect => {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return ['x', 'y', 'width', 'height'].every((k) => typeof r[k] === 'number' && Number.isFinite(r[k]))
}

/** Saved bounds when they overlap a display's work area by at least 100x100 px, else null. */
export function restoreBounds(saved: unknown, workAreas: Rect[]): Rect | null {
  if (!isRect(saved)) return null
  const visible = workAreas.some((a) => {
    const w = Math.min(saved.x + saved.width, a.x + a.width) - Math.max(saved.x, a.x)
    const h = Math.min(saved.y + saved.height, a.y + a.height) - Math.max(saved.y, a.y)
    return w >= MIN_OVERLAP && h >= MIN_OVERLAP
  })
  return visible ? { x: saved.x, y: saved.y, width: saved.width, height: saved.height } : null
}

export interface ScanWindowManager {
  open(): void
  isOpen(): boolean
  toggleFullScreen(): void
  /** Forwards scan-window messages to the main window and main-window messages to the scan window; drops anything else. */
  relay(senderId: number, message: unknown): void
  close(): void
}

export function createScanWindowManager(deps: {
  create(bounds: Rect | null): ScanWindowLike
  mainWindow(): ScanWindowLike | null
  readBounds(): unknown
  writeBounds(r: Rect): void
  workAreas(): Rect[]
  now?(): number
}): ScanWindowManager {
  const now = deps.now ?? Date.now
  let win: ScanWindowLike | null = null

  const live = (w: ScanWindowLike | null): w is ScanWindowLike => !!w && !w.isDestroyed()
  const tellMain = (open: boolean): void => {
    const main = deps.mainWindow()
    if (live(main)) main.webContents.send(SCAN_WINDOW_OPEN, open)
  }

  return {
    open() {
      if (live(win)) {
        if (win.isMinimized()) win.restore()
        win.focus()
        return
      }
      const created = deps.create(restoreBounds(deps.readBounds(), deps.workAreas()))
      win = created
      created.on('close', () => {
        deps.writeBounds(created.getNormalBounds())
      })
      created.on('closed', () => {
        if (win === created) win = null
        tellMain(false)
      })
      // A crashed page would leave the window open and blank, and the Scan page showing what it
      // said last. Reloaded, it scans again and resends any pull it hadn't heard was counted; one
      // that keeps crashing is closed, so the page scans in place instead.
      let crashedAt: number | null = null
      created.webContents.on('render-process-gone', (_e, { reason }) => {
        if (reason === 'clean-exit' || created.isDestroyed()) return
        const at = now()
        if (crashedAt !== null && at - crashedAt < CRASH_LOOP_MS) created.close()
        else created.webContents.reload()
        crashedAt = at
      })
      tellMain(true)
    },
    isOpen: () => live(win),
    toggleFullScreen() {
      if (live(win)) win.setFullScreen(!win.isFullScreen())
    },
    relay(senderId, message) {
      const main = deps.mainWindow()
      if (!live(main) || !live(win)) return
      if (senderId === win.webContents.id && isFromScanWindow(message)) {
        main.webContents.send(SCAN_WINDOW_MESSAGE, message)
      } else if (senderId === main.webContents.id && isToScanWindow(message)) {
        win.webContents.send(SCAN_WINDOW_MESSAGE, message)
      }
    },
    close() {
      if (live(win)) win.close()
    }
  }
}
