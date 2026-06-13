import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { Participant } from '../shared/types'

// ── Typed IPC wrapper ────────────────────────────────────────────────────────

interface RoomState {
  roomCode: string
  hostName: string
  participants: Participant[]
  status: 'open' | 'closed'
}

const api = {
  /**
   * Create/retrieve the current room.
   * Returns the room code for the host.
   */
  createRoom: (): Promise<{ roomCode: string }> => {
    return ipcRenderer.invoke('createRoom')
  },

  /**
   * Get the current room state (code, host, participants, status).
   */
  getRoomState: (): Promise<RoomState> => {
    return ipcRenderer.invoke('getRoomState')
  },

  /**
   * Subscribe to room state changes.
   * Returns an unsubscribe function.
   */
  onRoomStateChanged: (callback: (state: RoomState) => void): (() => void) => {
    const listener = (_event: unknown, state: RoomState) => callback(state)
    ipcRenderer.on('room:stateChanged', listener)
    return () => {
      ipcRenderer.removeListener('room:stateChanged', listener)
    }
  },

  /**
   * Subscribe to participant joined events.
   * Returns an unsubscribe function.
   */
  onParticipantJoined: (
    callback: (participant: Participant) => void
  ): (() => void) => {
    const listener = (_event: unknown, participant: Participant) => callback(participant)
    ipcRenderer.on('room:participantJoined', listener)
    return () => {
      ipcRenderer.removeListener('room:participantJoined', listener)
    }
  },

  /**
   * Subscribe to participant left events.
   * Returns an unsubscribe function.
   */
  onParticipantLeft: (
    callback: (participantId: string, name: string) => void
  ): (() => void) => {
    const listener = (_event: unknown, participantId: string, name: string) =>
      callback(participantId, name)
    ipcRenderer.on('room:participantLeft', listener)
    return () => {
      ipcRenderer.removeListener('room:participantLeft', listener)
    }
  }
}

// ── Expose to renderer ───────────────────────────────────────────────────────

contextBridge.exposeInMainWorld('electron', electronAPI)
contextBridge.exposeInMainWorld('api', api)
