import { contextBridge } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Expose the Electron API to the renderer process via contextBridge.
// The full ElectronAPI interface (from the design document) will be wired here
// in task 11.1. This stub satisfies the build requirement for the scaffold.
contextBridge.exposeInMainWorld('electron', electronAPI)

// Placeholder — the typed window.electronAPI will be added in task 11.1
contextBridge.exposeInMainWorld('electronAPI', {
  // Session stubs (wired in task 11.1)
  createRoom: (_name: string) => Promise.resolve({ error: 'not implemented' }),
  joinRoom: (_name: string, _roomCode: string) => Promise.resolve({ error: 'not implemented' }),
  leaveRoom: () => Promise.resolve()
})
