import { app, shell, BrowserWindow, dialog } from 'electron'
import { join } from 'path'
import { autoUpdater } from 'electron-updater'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import type { SyncStatus, UpdateStatus } from '@shared/types'
import { DATA_CHANGED, SYNC_PROGRESS, UPDATE_STATUS, WINDOW_MAXIMIZED } from '@shared/ipc'
import icon from '../../resources/icon.png?asset'
import { openDatabase } from './db/database'
import { getMeta } from './db/meta'
import { createYgoClient } from './ygo/client'
import { runSync, shouldSync } from './sync/sync'
import { hasSetData, refreshSets } from './sync/sets'
import { refreshIntlSets, shouldRefreshIntl } from './sync/intl'
import { createPriceService } from './prices/service'
import { refreshIntlPrices } from './prices/refresh'
import { createYugipediaClient } from './yugipedia/client'
import { createPrintingArtResolver } from './yugipedia/artResolver'
import { refreshSetLogos, shouldRefreshSetLogos } from './yugipedia/setLogos'
import { refreshPackArt, shouldRefreshPackArt } from './konami/packArt'
import { refreshKonamiLogos, shouldRefreshKonamiLogos } from './konami/logos'
import { createTcgplayerLookup, refreshTcgCatalog, shouldRefreshTcgCatalog } from './tcgplayer/catalog'
import { recordSnapshot } from './repo/stats'
import { findSetImageUrl } from './repo/sets'
import { createImageCache } from './images/cache'
import { prepareLogo } from './images/prepareLogo'
import { handleImageProtocol, registerImageScheme } from './images/protocol'
import { createUpdater, updateMode, RELEASES_URL } from './updater'
import { createHandlers, registerIpc, type AppDeps } from './ipc/handlers'
import { seedFakeCollection } from './dev/fakeData'

/** `npm run dev:fake-data`: a separate profile with a seeded collection; never in packaged builds. */
const fakeData = !app.isPackaged && process.env['YGO_FAKE_DATA'] === '1'
if (fakeData) app.setPath('userData', `${app.getPath('userData')}-fake-data`)

registerImageScheme()

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1100,
    minHeight: 700,
    title: 'Yugioh Collection Tracker',
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

function bootstrap(): void {
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
    if (fakeData && s.state === 'idle') seedFakeCollection(db)
    broadcast(SYNC_PROGRESS, s)
  }
  if (fakeData) seedFakeCollection(db)

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
      emitDataChanged
    })
  )

  createWindow()
  updater.start()

  recordSnapshot(db)
  void startupSync().catch((e) => console.error('Startup sync failed', e))

  async function startupSync(): Promise<void> {
    let changed = false
    if (shouldSync(getMeta(db, 'last_sync_at'), new Date())) {
      const status = await runSync(db, client, emitSync)
      if (status.state === 'idle') {
        recordSnapshot(db)
        changed = true
      }
    } else if (!hasSetData(db)) {
      changed = await refreshSets(db, client)
    }
    if (shouldRefreshTcgCatalog(db, new Date())) {
      // A few minutes at most; English cards then show their TCGplayer photos.
      const tcg = await refreshTcgCatalog(db, { version: app.getVersion() })
      if (tcg.updatedGroups > 0) emitDataChanged()
    }
    if (hasSetData(db) && shouldRefreshPackArt(db, new Date())) {
      if ((await refreshPackArt(db, { version: app.getVersion() })) > 0) emitDataChanged()
    }
    if (hasSetData(db) && shouldRefreshSetLogos(db, new Date())) {
      if ((await refreshSetLogos(db, yugipedia)) > 0) emitDataChanged()
    }
    if (hasSetData(db) && shouldRefreshKonamiLogos(db, new Date())) {
      if ((await refreshKonamiLogos(db, { version: app.getVersion() })) > 0) emitDataChanged()
    }
    const { n } = db.prepare('SELECT count(*) AS n FROM cards').get() as { n: number }
    if (n > 0 && shouldRefreshIntl(db, new Date())) {
      // Each saved batch refreshes the UI, so sets appear while a long first sync runs.
      await refreshIntlSets(db, yugipedia, new Date(), emitDataChanged)
      changed = true
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

  app.whenReady().then(() => {
    try {
      bootstrap()
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
