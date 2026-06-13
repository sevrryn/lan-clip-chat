/// <reference types="vite/client" />

import type {
  Message,
  Participant,
  FileTransferRecord,
  ConnectionState
} from '@shared/types'

/**
 * Typed window.electronAPI exposed by the preload script.
 * Full implementation in task 11.1.
 */
interface ElectronAPI {
  // Session
  createRoom(name: string): Promise<{ roomCode: string } | { error: string }>
  joinRoom(name: string, roomCode: string): Promise<{ ok: true } | { error: string }>
  leaveRoom(): Promise<void>

  // Chat
  sendMessage(text: string): Promise<{ ok: true } | { error: string }>
  sendImage(base64: string): Promise<{ ok: true } | { error: string }>
  deleteMessage(messageId: string): Promise<void>
  sendTyping(): Promise<void>

  // File
  pickAndSendFile(): Promise<{ transferId: string } | { error: string }>
  downloadFile(transferId: string, destPath: string): Promise<void>
  openFile(transferId: string): Promise<void>

  // Event subscriptions (return unsubscribe fn)
  onMessageReceived(cb: (msg: Message) => void): () => void
  onMessageDeleted(cb: (messageId: string) => void): () => void
  onParticipantList(cb: (participants: Participant[]) => void): () => void
  onTyping(cb: (senderId: string, senderName: string) => void): () => void
  onFileProgress(cb: (record: FileTransferRecord) => void): () => void
  onConnectionStatus(cb: (status: ConnectionState) => void): () => void
  onSessionEnded(cb: () => void): () => void
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
