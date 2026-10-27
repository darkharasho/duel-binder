import { describe, expect, it, vi } from 'vitest'
import {
  createScanWindowManager,
  restoreBounds,
  type Rect,
  type ScanWindowLike
} from '../../src/main/scanWindow'

type Send = [string, unknown]
interface Fake extends ScanWindowLike {
  sends: Send[]
  minimized: boolean
  fire(event: 'close' | 'closed'): void
}

function fakeWindow(id: number, bounds: Rect = { x: 10, y: 20, width: 800, height: 450 }): Fake {
  const handlers: Record<string, (() => void)[]> = {}
  const w: Fake = {
    sends: [],
    minimized: false,
    webContents: { id, send: (c, p) => void w.sends.push([c, p]) },
    isDestroyed: () => false,
    isMinimized: () => w.minimized,
    restore: vi.fn(() => void (w.minimized = false)),
    focus: vi.fn(),
    close: vi.fn(),
    isFullScreen: vi.fn(() => false),
    setFullScreen: vi.fn(),
    getNormalBounds: () => bounds,
    on: (event, cb) => void (handlers[event] ??= []).push(cb),
    fire: (event) => handlers[event]?.forEach((cb) => cb())
  }
  return w
}

const SCREEN: Rect = { x: 0, y: 0, width: 1920, height: 1080 }
const draft = { cardId: 1 } as never
const settings = { deviceId: null } as never

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function setup(saved: unknown = null) {
  const main = fakeWindow(1)
  const scan = fakeWindow(2)
  const create = vi.fn<(bounds: Rect | null) => ScanWindowLike>(() => scan)
  const writeBounds = vi.fn()
  const mainRef: { win: Fake | null } = { win: main }
  const manager = createScanWindowManager({
    create,
    mainWindow: () => mainRef.win,
    readBounds: () => saved,
    writeBounds,
    workAreas: () => [SCREEN]
  })
  return { main, scan, create, writeBounds, manager, mainRef }
}

describe('scan window manager', () => {
  it('open creates the window once and brings it to the front after that', () => {
    const { manager, create, scan } = setup()
    manager.open()
    scan.minimized = true
    manager.open()
    expect(create).toHaveBeenCalledTimes(1)
    expect(scan.restore).toHaveBeenCalledTimes(1)
    expect(scan.focus).toHaveBeenCalledTimes(1)
  })

  it('tells the main window when the scan window opens and closes', () => {
    const { manager, main, scan } = setup()
    expect(manager.isOpen()).toBe(false)
    manager.open()
    expect(main.sends).toEqual([['scanWindow:openChanged', true]])
    expect(manager.isOpen()).toBe(true)
    scan.fire('closed')
    expect(main.sends[1]).toEqual(['scanWindow:openChanged', false])
    expect(manager.isOpen()).toBe(false)
  })

  it('relays state and drafts to the main window, settings and retries to the scan window', () => {
    const { manager, main, scan } = setup()
    manager.open()
    main.sends.length = 0
    manager.relay(2, { kind: 'draft', draft })
    expect(main.sends).toEqual([['scanWindow:message', { kind: 'draft', draft }]])
    manager.relay(1, { kind: 'settings', settings })
    manager.relay(1, { kind: 'retryCamera' })
    expect(scan.sends).toEqual([
      ['scanWindow:message', { kind: 'settings', settings }],
      ['scanWindow:message', { kind: 'retryCamera' }]
    ])
  })

  it('drops messages in the wrong direction, from unknown windows, or malformed', () => {
    const { manager, main, scan, mainRef } = setup()
    manager.open()
    main.sends.length = 0
    expect(() => {
      manager.relay(1, { kind: 'draft', draft })
      manager.relay(2, { kind: 'settings', settings })
      manager.relay(99, { kind: 'ready' })
      manager.relay(2, 'x')
      manager.relay(2, null)
      mainRef.win = null
      manager.relay(2, { kind: 'ready' })
    }).not.toThrow()
    expect(main.sends).toEqual([])
    expect(scan.sends).toEqual([])
  })

  it('remembers its bounds and reopens there', () => {
    const saved = { x: 100, y: 100, width: 640, height: 360 }
    const { manager, scan, create, writeBounds } = setup(saved)
    manager.open()
    expect(create).toHaveBeenLastCalledWith(saved)
    scan.fire('close')
    expect(writeBounds).toHaveBeenCalledWith(scan.getNormalBounds())
    scan.fire('closed')
    manager.open()
    expect(create).toHaveBeenCalledTimes(2)
  })

  it('opens at the default size when the saved bounds are on a display that is gone', () => {
    const { manager, create } = setup({ x: 5000, y: 0, width: 800, height: 450 })
    manager.open()
    expect(create).toHaveBeenCalledWith(null)
  })

  it('close closes the scan window', () => {
    const { manager, scan } = setup()
    manager.close()
    expect(scan.close).not.toHaveBeenCalled()
    manager.open()
    manager.close()
    expect(scan.close).toHaveBeenCalledTimes(1)
  })

  it('toggleFullScreen flips the scan window', () => {
    const { manager, scan } = setup()
    manager.toggleFullScreen()
    manager.open()
    manager.toggleFullScreen()
    expect(scan.setFullScreen).toHaveBeenCalledWith(true)
  })
})

describe('restoreBounds', () => {
  const area = [SCREEN]
  it('keeps bounds that are on a display', () => {
    const r = { x: 100, y: 50, width: 1280, height: 720 }
    expect(restoreBounds(r, area)).toEqual(r)
  })
  it('drops bounds on a display that is gone', () => {
    expect(restoreBounds({ x: 5000, y: 0, width: 1280, height: 720 }, area)).toBeNull()
  })
  it('drops bounds that barely overlap', () => {
    expect(restoreBounds({ x: 1850, y: 0, width: 1280, height: 720 }, area)).toBeNull()
  })
  it('drops garbage', () => {
    expect(restoreBounds(null, area)).toBeNull()
    expect(restoreBounds({}, area)).toBeNull()
    expect(restoreBounds({ x: 'a' }, area)).toBeNull()
  })
})
