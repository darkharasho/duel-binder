import { app, shell, BrowserWindow, dialog, ipcMain, net, screen, session } from 'electron'
import { readFileSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'
import { autoUpdater } from 'electron-updater'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import type { AccountStatus, SyncStatus, UpdateStatus } from '@shared/types'
import {
  ACCOUNT_CHANGED,
  DATA_CHANGED,
  SCAN_WINDOW_SEND,
  SYNC_PROGRESS,
  UPDATE_STATUS,
  WINDOW_MAXIMIZED
} from '@shared/ipc'
import icon from '../../resources/icon.png?asset'
import { openDatabase } from './db/database'
import { createCatalogService } from './catalog/service'
import { recordSnapshot } from './repo/stats'
import {
  directCatalog,
  directImageSources,
  directPrintingArt,
  startDirectCatalog
} from './dev/directSources'
import { createImageCache } from './images/cache'
import { portalImageSources } from './images/portalSources'
import { prepareLogo } from './images/prepareLogo'
import { handleImageProtocol, registerImageScheme } from './images/protocol'
import { createUpdater, updateMode, RELEASES_URL } from './updater'
import { restrictPermissions } from './permissions'
import { createScanWindowManager, type Rect, type ScanWindowManager } from './scanWindow'
import { createHandlers, registerIpc, type AppDeps } from './ipc/handlers'
import { seedFakeCollection } from './dev/fakeData'
import { resolveUserData } from './userData'
import { captureShots } from './dev/capture'
import { createAccountService } from './cloud/account'
import { createCloudClient } from './cloud/client'
import { createFingerprintStore } from './scan/fingerprints'
import { createOcr, engLangPath } from './scan/ocr'
import { portalUrl } from './cloud/config'
import { signInWithBrowser } from './cloud/signIn'
import { TokenStore, electronCipher } from './cloud/tokenStore'

// Launched from a desktop menu, stdout/stderr can be closed pipes; a console.log then emits EPIPE,
// which would surface as an uncaught exception dialog. Logging is best-effort, so drop those errors.
for (const stream of [process.stdout, process.stderr]) {
  stream.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code !== 'EPIPE') throw err
  })
}

// The app was "yugioh-collection-tracker" before it became Duel Binder: move that data folder over once.
// If the move fails (e.g. Windows holds a lock on it), keep using the old folder rather than start empty.
// Unpackaged, DUEL_BINDER_USER_DATA points the app at another data folder instead (e.g. a copy to try
// a migration on).
const userDataOverride = !app.isPackaged ? process.env['DUEL_BINDER_USER_DATA'] : undefined
app.setPath(
  'userData',
  userDataOverride ? resolve(userDataOverride) : resolveUserData(app.getPath('appData'))
)

/** `npm run dev:fake-data`: a separate profile with a seeded collection; never in packaged builds.
 *  `npm run site:shots`: screenshots of that profile for the marketing site, then quit. */
const captureDir = !app.isPackaged ? process.env['YGO_CAPTURE_DIR'] : undefined
const fakeData = !app.isPackaged && (process.env['YGO_FAKE_DATA'] === '1' || !!captureDir)
if (captureDir) app.commandLine.appendSwitch('force-device-scale-factor', '2')
// Capture uses its own profile so it never collides with a running dev session's instance lock.
if (fakeData)
  app.setPath('userData', `${app.getPath('userData')}-fake-data${captureDir ? '-capture' : ''}`)

registerImageScheme()

let mainWindow: BrowserWindow | null = null
let scanWindows: ScanWindowManager | null = null
let windowShown: Promise<void> = Promise.resolve()
let markSeeded: () => void = () => {}
const seeded = new Promise<void>((r) => (markSeeded = r))

/** Never let a window navigate away from the app (e.g. a dropped file or link). */
function guardNavigation(win: BrowserWindow): void {
  const devUrl = is.dev ? process.env['ELECTRON_RENDERER_URL'] : undefined
  win.webContents.on('will-navigate', (event, url) => {
    if (devUrl && url.startsWith(devUrl)) return
    event.preventDefault()
  })

  win.webContents.setWindowOpenHandler((details) => {
    try {
      if (new URL(details.url).protocol === 'https:') void shell.openExternal(details.url)
    } catch {
      // invalid URL: deny
    }
    return { action: 'deny' }
  })
}

/** The scan window: the camera and the pull overlays, in a window the owner can share. */
function createScanBrowserWindow(bounds: Rect | null): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 720,
    ...(bounds ?? {}),
    minWidth: 480,
    minHeight: 270,
    title: 'Duel Binder — Scan',
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // A covered or minimized window keeps scanning.
      backgroundThrottling: false
    }
  })

  win.on('page-title-updated', (event) => event.preventDefault())
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    if (input.key === 'F11') {
      win.setFullScreen(!win.isFullScreen())
      event.preventDefault()
    } else if (input.key === 'Escape' && win.isFullScreen()) {
      win.setFullScreen(false)
      event.preventDefault()
    }
  })
  guardNavigation(win)

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'] + '#scan')
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'scan' })
  }
  return win
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1100,
    minHeight: 700,
    title: 'Duel Binder',
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#111113',
    // The renderer draws the title bar (TitleBar.tsx): macOS keeps its traffic lights, Windows keeps
    // native caption buttons as an overlay, Linux gets drawn buttons.
    titleBarStyle: 'hidden',
    ...(process.platform === 'darwin' ? { trafficLightPosition: { x: 14, y: 12 } } : {}),
    ...(process.platform === 'win32'
      ? { titleBarOverlay: { color: '#111113', symbolColor: '#ecebe8', height: 36 } }
      : {}),
    ...(process.platform === 'linux' ? { icon, frame: false } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  mainWindow = win
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
    scanWindows?.close()
  })
  const sendMaximized = (): void => {
    if (!win.isDestroyed()) win.webContents.send(WINDOW_MAXIMIZED, win.isMaximized())
  }
  win.on('maximize', sendMaximized)
  win.on('unmaximize', sendMaximized)
  windowShown = new Promise((r) => win.once('show', () => r()))
  win.on('ready-to-show', () => {
    win.show()
  })

  guardNavigation(win)

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

/** `YYYY-MM-DD` in local time. */
function localDate(d: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send(channel, payload)
}

async function bootstrap(): Promise<void> {
  const launchedAt = new Date()
  electronApp.setAppUserModelId('com.darkharasho.yugiohcollectiontracker')

  // The webcam (Scan) is the only permission the app's pages get, and nothing else gets any.
  restrictPermissions(
    session.defaultSession,
    is.dev ? process.env['ELECTRON_RENDERER_URL'] : undefined
  )

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  const userData = app.getPath('userData')
  const db = openDatabase(join(userData, 'collection.db'))
  const portal = portalUrl(process.env, app.isPackaged)
  const tokens = new TokenStore(join(userData, 'account.json'), await electronCipher())
  const remoteIdOf = db.prepare('SELECT remote_id FROM card_printings WHERE id = ?').pluck()
  const images = createImageCache({
    dir: join(userData, 'images'),
    sources: fakeData
      ? directImageSources({
          db,
          version: app.getVersion(),
          resolvePrintingArt: directPrintingArt(db, app.getVersion())
        })
      : portalImageSources({
          portal,
          token: () => tokens.get(),
          remoteId: (id) => (remoteIdOf.get(id) as number | null | undefined) ?? null
        }),
    prepareLogo
  })
  handleImageProtocol(images)

  const emitSync = (s: SyncStatus): void => {
    // Seed before the renderer hears "idle" and refetches.
    if (fakeData && s.state === 'idle') {
      seedFakeCollection(db)
      markSeeded()
    }
    broadcast(SYNC_PROGRESS, s)
  }
  if (fakeData) {
    seedFakeCollection(db)
    // Already seeded by an earlier run, or just now: nothing to wait for.
    if (db.prepare('SELECT 1 FROM collection_entries WHERE deleted_at IS NULL LIMIT 1').get())
      markSeeded()
  }

  const updater = createUpdater({
    autoUpdater,
    mode: updateMode(process.platform, __MAC_SIGNED__),
    emit: (s: UpdateStatus) => broadcast(UPDATE_STATUS, s),
    // Only ever opens the releases page of this project.
    openExternal: async (url) => {
      if (url === RELEASES_URL || url.startsWith(`${RELEASES_URL}/`)) await shell.openExternal(url)
    },
    enabled: app.isPackaged
  })
  app.on('before-quit', () => updater.stop())
  app.on('will-quit', () => db.close())

  const appDeps: AppDeps = {
    version: () => app.getVersion(),
    openDataFolder: async () => {
      const error = await shell.openPath(userData)
      if (error) throw new Error(`Couldn't open the data folder: ${error}`)
    },
    backupDatabase: async () => {
      const { canceled, filePath } = await dialog.showSaveDialog({
        defaultPath: `duel-binder-${localDate(new Date())}.db`
      })
      if (canceled || !filePath) return null
      await db.backup(filePath)
      return filePath
    },
    checkForUpdates: () => updater.check(),
    applyUpdate: () => updater.apply(),
    updateStatus: async () => updater.status()
  }

  const emitDataChanged = (): void => broadcast(DATA_CHANGED, undefined)
  const fingerprints = createFingerprintStore({ dir: join(userData, 'scan'), portal })
  // The dev fake-data profile keeps the self-built catalog and can be used signed out.
  const catalog = fakeData
    ? directCatalog(db)
    : createCatalogService({
        db,
        backupPath: (now) =>
          join(userData, 'backups', `${localDate(now)}-pre-server-catalog.sqlite`),
        emit: emitSync,
        launchedAt
      })

  const account = createAccountService({
    db,
    tokens,
    client: (token, opts = {}) =>
      createCloudClient({ baseUrl: portal, token, timeoutMs: opts.timeoutMs, signal: opts.signal }),
    signIn: (signal) =>
      signInWithBrowser({
        portalUrl: portal,
        openExternal: (url) => shell.openExternal(url),
        signal
      }),
    emit: (s: AccountStatus) => broadcast(ACCOUNT_CHANGED, s),
    emitDataChanged,
    isOnline: () => net.isOnline(),
    catalog,
    onCatalogChanged: ({ imagesChanged }) => {
      recordSnapshot(db)
      if (imagesChanged) void fingerprints.refresh({ force: true }).catch(() => {})
    },
    signInRequired: !fakeData
  })
  app.on('before-quit', () => account.stop())
  const ocr = createOcr({ langPath: engLangPath(app.isPackaged) })
  app.on('will-quit', () => void ocr.dispose().catch(() => {}))

  const windowDeps = {
    minimize: () => mainWindow?.minimize(),
    toggleMaximize: () => {
      if (!mainWindow) return
      if (mainWindow.isMaximized()) mainWindow.unmaximize()
      else mainWindow.maximize()
    },
    close: () => mainWindow?.close(),
    isMaximized: () => mainWindow?.isMaximized() ?? false
  }

  const boundsFile = join(userData, 'scan-window.json')
  const scanWindow = createScanWindowManager({
    create: createScanBrowserWindow,
    mainWindow: () => mainWindow,
    readBounds: () => {
      try {
        return JSON.parse(readFileSync(boundsFile, 'utf8'))
      } catch {
        return null
      }
    },
    writeBounds: (r) => {
      try {
        writeFileSync(boundsFile, JSON.stringify(r))
      } catch {
        // the window just opens at the default size next time
      }
    },
    workAreas: () => screen.getAllDisplays().map((d) => d.workArea)
  })
  scanWindows = scanWindow
  ipcMain.on(SCAN_WINDOW_SEND, (e, m) => scanWindow.relay(e.sender.id, m))

  registerIpc(
    createHandlers({
      db,
      images,
      catalog,
      app: appDeps,
      window: windowDeps,
      scanWindow,
      account,
      fingerprints,
      ocr
    })
  )

  createWindow()
  updater.start()
  account.start()

  if (captureDir) {
    const win = mainWindow
    void Promise.all([windowShown, seeded])
      .then(async () => {
        if (!win) throw new Error('No window to capture')
        await new Promise((r) => setTimeout(r, 2000))
        console.log((await captureShots(win, resolve(captureDir))).join('\n'))
        app.quit()
      })
      .catch((e) => {
        console.error('Capture failed', e)
        app.exit(1)
      })
  }

  recordSnapshot(db)
  if (fakeData) {
    void startDirectCatalog(db, {
      version: app.getVersion(),
      onSyncProgress: emitSync,
      onSynced: () => {
        recordSnapshot(db)
        void fingerprints.refresh({ force: true }).catch(() => {})
      },
      onChanged: emitDataChanged
    })
      .then(({ changed }) => {
        account.catalogRefreshed()
        // TCGplayer prices may have moved the collection's value.
        recordSnapshot(db)
        if (changed) emitDataChanged()
      })
      .catch((e) => console.error('Startup sync failed', e))
  }

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  app.whenReady().then(async () => {
    try {
      await bootstrap()
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      dialog.showErrorBox(
        "Couldn't open your collection",
        `${message}\n\nData folder: ${app.getPath('userData')}`
      )
      app.quit()
    }
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
