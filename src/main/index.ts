import { app, shell, BrowserWindow, dialog } from 'electron'
import { join } from 'path'
import { autoUpdater } from 'electron-updater'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import type { SyncStatus, UpdateStatus } from '@shared/types'
import { SYNC_PROGRESS, UPDATE_STATUS } from '@shared/ipc'
import icon from '../../resources/icon.png?asset'
import { openDatabase } from './db/database'
import { getMeta } from './db/meta'
import { createYgoClient } from './ygo/client'
import { runSync, shouldSync } from './sync/sync'
import { recordSnapshot } from './repo/stats'
import { createImageCache } from './images/cache'
import { handleImageProtocol, registerImageScheme } from './images/protocol'
import { createUpdater, updateMode, RELEASES_URL } from './updater'
import { createHandlers, registerIpc, type AppDeps } from './ipc/handlers'

registerImageScheme()

function createWindow(): void {
  const mainWindow = new BrowserWindow({
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

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    try {
      if (new URL(details.url).protocol === 'https:') void shell.openExternal(details.url)
    } catch {
      // invalid URL: deny
    }
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send(channel, payload)
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.darkharasho.yugiohcollectiontracker')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  const userData = app.getPath('userData')
  const db = openDatabase(join(userData, 'collection.db'))
  const images = createImageCache({ dir: join(userData, 'images') })
  handleImageProtocol(images)

  const client = createYgoClient()
  const emitSync = (s: SyncStatus): void => broadcast(SYNC_PROGRESS, s)

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

  const appDeps: AppDeps = {
    version: () => app.getVersion(),
    openDataFolder: async () => {
      await shell.openPath(userData)
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
    applyUpdate: () => updater.apply()
  }

  registerIpc(createHandlers({ db, client, images, emitSync, app: appDeps }))

  createWindow()
  updater.start()

  recordSnapshot(db)
  if (shouldSync(getMeta(db, 'last_sync_at'), new Date())) {
    void runSync(db, client, emitSync).then((status) => {
      if (status.state === 'idle') recordSnapshot(db)
    }).catch((e) => console.error('Startup sync failed', e))
  }

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
