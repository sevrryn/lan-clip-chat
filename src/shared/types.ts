/**
 * Shared data-model interfaces and connection-state types.
 * Fully implemented in task 2.1.
 */

// ── Participants ──────────────────────────────────────────────────────────────

export interface Participant {
  id: string // UUID assigned by server on connect
  name: string // Display name, 1–50 chars trimmed
  isHost: boolean
}

// ── Messages ──────────────────────────────────────────────────────────────────

export type MessageType = 'text' | 'image'

export interface Message {
  id: string // UUID v4, assigned by sender
  type: MessageType
  senderId: string // Participant.id
  senderName: string // Denormalized for display
  content: string // Text body (≤500 chars) or base64 image data
  receivedAt: number // unix ms timestamp, set locally on receipt
  deleted: boolean // soft-delete flag
}

// ── File transfers ────────────────────────────────────────────────────────────

export type FileTransferStatus = 'pending' | 'in-progress' | 'complete' | 'interrupted'

export interface FileTransferRecord {
  id: string // UUID v4
  filename: string
  totalBytes: number
  bytesTransferred: number
  status: FileTransferStatus
  senderId: string
  localPath?: string // Set on receiver when download is available
  startedAt: number // unix ms
}

// ── Room ─────────────────────────────────────────────────────────────────────

export interface RoomState {
  roomCode: string // 6-digit zero-padded string
  localParticipantId: string
  isHost: boolean
  wsPort: number // Ephemeral port (49152–65535)
}

// ── Connection ───────────────────────────────────────────────────────────────

export type ConnectionState = 'connected' | 'reconnecting' | 'disconnected'
