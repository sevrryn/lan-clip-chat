/**
 * IpcBridge — forwards RoomManager events to the renderer process.
 *
 * Listens to RoomManager events and sends them to the renderer via
 * ipcRenderer channels defined in preload/index.ts.
 *
 * Responsibilities:
 *  - Subscribe to RoomManager events
 *  - Transform events into renderer-friendly payloads
 *  - Send via mainWindow.webContents.send() on exact IPC channels
 *  - Clean up listeners on room close or window close
 *
 * CONSTRAINT:
 *  - This is the ONLY place that talks to webContents.send
 */

import { BrowserWindow } from 'electron'
import type { RoomManager } from './RoomManager'
import type { Participant, Message } from '../shared/types'

export class IpcBridge {
  private roomManager: RoomManager
  private mainWindow: BrowserWindow
  private unsubscribers: Array<() => void> = []

  constructor(roomManager: RoomManager, mainWindow: BrowserWindow) {
    this.roomManager = roomManager
    this.mainWindow = mainWindow
    this._attachListeners()
  }

  /**
   * Attach listeners to RoomManager events.
   */
  private _attachListeners(): void {
    // participantJoined
    const unsubParticipantJoined = this._onParticipantJoined.bind(this)
    this.roomManager.on('participantJoined', unsubParticipantJoined)
    this.unsubscribers.push(() => {
      this.roomManager.removeListener('participantJoined', unsubParticipantJoined)
    })

    // participantLeft
    const unsubParticipantLeft = this._onParticipantLeft.bind(this)
    this.roomManager.on('participantLeft', unsubParticipantLeft)
    this.unsubscribers.push(() => {
      this.roomManager.removeListener('participantLeft', unsubParticipantLeft)
    })

    // messageReceived
    const unsubMessageReceived = this._onMessageReceived.bind(this)
    this.roomManager.on('messageReceived', unsubMessageReceived)
    this.unsubscribers.push(() => {
      this.roomManager.removeListener('messageReceived', unsubMessageReceived)
    })

    // messageDeleted
    const unsubMessageDeleted = this._onMessageDeleted.bind(this)
    this.roomManager.on('messageDeleted', unsubMessageDeleted)
    this.unsubscribers.push(() => {
      this.roomManager.removeListener('messageDeleted', unsubMessageDeleted)
    })

    // room closed
    const unsubClosed = this._onRoomClosed.bind(this)
    this.roomManager.on('closed', unsubClosed)
    this.unsubscribers.push(() => {
      this.roomManager.removeListener('closed', unsubClosed)
    })
  }

  /**
   * Clean up all listeners.
   */
  dispose(): void {
    for (const unsub of this.unsubscribers) {
      unsub()
    }
    this.unsubscribers = []
  }

  // ── Event handlers ─────────────────────────────────────────────────────────

  private _onParticipantJoined(participant: Participant): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return
    this.mainWindow.webContents.send('room:participantJoined', participant)
  }

  private _onParticipantLeft(socketId: string, name: string): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return
    this.mainWindow.webContents.send('room:participantLeft', socketId, name)
  }

  private _onMessageReceived(message: Message): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return
    this.mainWindow.webContents.send('chat:message-received', message)
  }

  private _onMessageDeleted(messageId: string): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return
    this.mainWindow.webContents.send('chat:message-deleted', messageId)
  }

  private _onRoomClosed(): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return
    this.mainWindow.webContents.send('room:closed')
  }
}
