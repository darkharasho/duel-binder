import { app, shell, BrowserWindow, dialog, net } from 'electron'
import { join, resolve } from 'path'
import { autoUpdater } from 'electron-updater'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import type { AccountStatus, SyncStatus, UpdateStatus } from '@shared/types'
import { ACCOUNT_CHANGED, DATA_CHANGED, SYNC_PROGRESS, UPDATE_STATUS, WINDOW_MAXIMIZED } from '@shared/ipc'
import icon from '../../resources/icon.png?asset'
import { openDatabase } from './db/database'
import { createYgoClient } from './ygo/client'
import { refreshCatalog } from './sync/catalog'
import { createPriceService } from './prices/service'
import { refreshIntlPrices } from './prices/refresh'
import { createYugipediaClient } from './yugipedia/client'
import { createPrintingArtResolver } from './yugipedia/artResolver'
import { createTcgplayerLookup } from './tcgplayer/catalog'
import { recordSnapshot } from './repo/stats'
import { findSetImageUrl } from './repo/sets'
import { createImageCache } from './images/cache'
import { prepareLogo } from './images/prepareLogo'
import { handleImageProtocol, registerImageScheme } from './images/protocol'
import { createUpdater, updateMode, RELEASES_URL } from './updater'
import { createHandlers, registerIpc, type AppDeps } from './ipc/handlers'
import { seedFakeCollection } from './dev/fakeData'
import { captureShots } from './dev/capture'
import { createAccountService } from './cloud/account'
import { createCloudClient } from './cloud/client'
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

// The app was "yugioh-collection-tracker" before it became Duel Binder; keep reading the same data folder.
app.setPath('userData', join(app.getPath('appData'), 'yugioh-collection-tracker'))

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
let windowShown: Promise<void> = Promise.resolve()
let markSeeded: () => void = () => {}
const seeded = new Promise<void>((r) => (markSeeded = r))

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

  // Never let the window navigate away from the app (e.g. a dropped file or link).
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

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send(channel, payload)
}

async function bootstrap(): Promise<void> {
  electronApp.setAppUserModelId('com.darkharasho.yugiohcollectiontracker')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  const userData = app.getPath('userData')
  const db = openDatabase(join(userData, 'collection.db'))
  // One Yugipedia client, so set syncs and art lookups share its request pacing.
  const yugipedia = createYugipediaClient({ version: app.getVersion() })
  const printingArt = createPrintingArtResolver({
    db,
    client: yugipedia,
    quickUrl: createTcgplayerLookup(db)
  })
  const images = createImageCache({
    dir: join(userData, 'images'),
    version: app.getVersion(),
    resolveSetImage: (key) => findSetImageUrl(db, key),
    prepareLogo,
    resolvePrintingArt: (id) => printingArt.url(id)
  })
  handleImageProtocol(images)

  const client = createYgoClient()
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
    if (db.prepare('SELECT 1 FROM collection_entries WHERE deleted_at IS NULL LIMIT 1').get()) markSeeded()
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
      const now = new Date()
      const pad = (n: number): string => String(n).padStart(2, '0')
      const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
      const { canceled, filePath } = await dialog.showSaveDialog({
        defaultPath: `yugioh-collection-${date}.db`
      })
      if (canceled || !filePath) return null
      await db.backup(filePath)
      return filePath
    },
    checkForUpdates: () => updater.check(),
    applyUpdate: () => updater.apply(),
    updateStatus: async () => updater.status()
  }

  const priceService = createPriceService(db)
  const emitDataChanged = (): void => broadcast(DATA_CHANGED, undefined)

  const portal = portalUrl(process.env, app.isPackaged)
  const account = createAccountService({
    db,
    tokens: new TokenStore(join(userData, 'account.json'), await electronCipher()),
    client: (token, opts = {}) =>
      createCloudClient({ baseUrl: portal, token, timeoutMs: opts.timeoutMs, signal: opts.signal }),
    signIn: (signal) =>
      signInWithBrowser({ portalUrl: portal, openExternal: (url) => shell.openExternal(url), signal }),
    emit: (s: AccountStatus) => broadcast(ACCOUNT_CHANGED, s),
    emitDataChanged,
    isOnline: () => net.isOnline()
  })
  app.on('before-quit', () => account.stop())

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

  registerIpc(
    createHandlers({
      db,
      client,
      images,
      emitSync,
      app: appDeps,
      window: windowDeps,
      prices: priceService,
      emitDataChanged,
      account
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
  void startupSync().catch((e) => console.error('Startup sync failed', e))

  async function startupSync(): Promise<void> {
    const { changed } = await refreshCatalog(db, {
      client,
      yugipedia,
      version: app.getVersion(),
      onSyncProgress: emitSync,
      onSynced: () => recordSnapshot(db),
      onChanged: emitDataChanged
    })
    account.catalogRefreshed()
    // TCGplayer prices may have moved the collection's value.
    recordSnapshot(db)
    // Signed in, prices come from the account's server; signed out, straight from the eBay Worker.
    if (account.isSignedIn()) {
      if (changed) emitDataChanged()
      return
    }
    // refreshIntlPrices never rejects; failures still change the shown no-price reason.
    const prices = await refreshIntlPrices(db, priceService.client())
    if (prices.updated > 0) recordSnapshot(db)
    if (changed || prices.updated > 0 || prices.failed > 0) emitDataChanged()
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
