import { app, shell, BrowserWindow, dialog } from 'electron'
import { join } from 'path'
import { autoUpdater } from 'electron-updater'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import type { SyncStatus, UpdateStatus } from '@shared/types'
import { DATA_CHANGED, SYNC_PROGRESS, UPDATE_STATUS } from '@shared/ipc'
import icon from '../../resources/icon.png?asset'
import { openDatabase } from './db/database'
import { getMeta, setMeta } from './db/meta'
import { createYgoClient } from './ygo/client'
import { runSync, shouldSync } from './sync/sync'
import { hasSetData, refreshSets } from './sync/sets'
import { refreshIntlSets, shouldRefreshIntl } from './sync/intl'
import { createPriceClient } from './prices/client'
import { priceWorkerUrl } from './prices/config'
import { refreshIntlPrices } from './prices/refresh'
import { createYugipediaClient } from './yugipedia/client'
import { recordSnapshot } from './repo/stats'
import { createImageCache } from './images/cache'
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
    ...(process.platform === 'linux' ? { icon } : {}),
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
  const images = createImageCache({
    dir: join(userData, 'images'),
    version: app.getVersion(),
    resolveSetImage: (key) =>
      (
        db.prepare('SELECT image_url FROM sets WHERE image_key = ?').get(key) as
          { image_url: string | null } | undefined
      )?.image_url ?? null
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

  const workerUrl = priceWorkerUrl()
  const priceClient = workerUrl ? createPriceClient({ url: workerUrl }) : null
  if (!priceClient) setMeta(db, 'price_service_status', 'unavailable')
  const emitDataChanged = (): void => broadcast(DATA_CHANGED, undefined)

  registerIpc(createHandlers({ db, client, images, emitSync, app: appDeps, priceClient, emitDataChanged }))

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
    const { n } = db.prepare('SELECT count(*) AS n FROM cards').get() as { n: number }
    if (n > 0 && shouldRefreshIntl(db, new Date())) {
      await refreshIntlSets(db, createYugipediaClient({ version: app.getVersion() }))
      changed = true
    }
    const prices = await refreshIntlPrices(db, priceClient)
    if (prices.updated > 0) changed = true
    if (changed) emitDataChanged()
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
