import { app, BrowserWindow, shell, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { WebSocketServer } from './WebSocketServer'
import { RoomManager } from './RoomManager'
import { generateRoomCode } from './validation'

let roomManager: RoomManager | null = null
let wsServer: WebSocketServer | null = null

function createWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // In development, load the Vite dev server; in production, load the built file.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

/**
 * Initialize WebSocketServer and RoomManager on app startup.
 * Creates a single room for testing.
 */
async function initializeBackend(): Promise<void> {
  // Create WebSocket server
  wsServer = new WebSocketServer()
  const port = await wsServer.start()
  console.log(`[main] WebSocketServer started on port ${port}`)

  // Generate room code and create RoomManager
  const roomCode = generateRoomCode()
  const hostName = 'host'
  const hostSocketId = 'host-socket-id-bootstrap' // Dummy ID for bootstrap

  roomManager = new RoomManager(wsServer, roomCode, hostName, hostSocketId)
  console.log(`[main] RoomManager created with room code ${roomCode}`)

  // Log room state for debugging
  const state = roomManager.getState()
  console.log(`[main] Room state:`, state)
}

/**
 * IPC: Get room code and basic info
 */
ipcMain.handle('createRoom', async () => {
  if (!roomManager) {
    throw new Error('RoomManager not initialized')
  }
  const state = roomManager.getState()
  return {
    roomCode: state.roomCode,
  }
})

/**
 * IPC: Get current room state
 */
ipcMain.handle('getRoomState', async () => {
  if (!roomManager) {
    throw new Error('RoomManager not initialized')
  }
  const state = roomManager.getState()
  return {
    roomCode: state.roomCode,
    hostName: state.hostName,
    participants: Array.from(state.participants.values()),
    status: state.status,
  }
})

app.whenReady().then(async () => {
  // Set the application user model id for Windows
  electronApp.setAppUserModelId('com.lan-clip-chat.app')

  // Default open or close DevTools by F12 in development, ignore in production.
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Initialize backend (WebSocket + RoomManager)
  try {
    await initializeBackend()
  } catch (err) {
    console.error('[main] Failed to initialize backend:', err)
  }

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// Clean up on exit
app.on('before-quit', async () => {
  // Stop WebSocket server
  if (wsServer) {
    try {
      await wsServer.stop()
      console.log('[main] WebSocketServer stopped')
    } catch (err) {
      console.warn('[main] Error stopping WebSocketServer:', err)
    }
  }

  // Clean up temp files on exit (Requirement 18.4)
  const { rmSync } = require('fs')
  const { tmpdir } = require('os')
  const { join: pathJoin } = require('path')
  const tempDir = pathJoin(tmpdir(), 'lan-clip-chat')
  try {
    rmSync(tempDir, { recursive: true, force: true })
  } catch {
    // Silently ignore if temp dir doesn't exist or can't be removed
  }
})
