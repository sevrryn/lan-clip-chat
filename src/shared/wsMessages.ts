/**
 * Discriminated union of all WebSocket message shapes.
 * Fully implemented in task 2.1.
 */

import type { Participant } from './types'

// ── Control messages ──────────────────────────────────────────────────────────

export interface HelloMessage {
  type: 'HELLO'
  participantId: string
  name: string
}

export interface WelcomeMessage {
  type: 'WELCOME'
  participants: Participant[]
  assignedId: string
}

export interface ParticipantListMessage {
  type: 'PARTICIPANT_LIST'
  participants: Participant[]
}

export interface ParticipantJoinedMessage {
  type: 'PARTICIPANT_JOINED'
  participant: Participant
}

export interface ParticipantLeftMessage {
  type: 'PARTICIPANT_LEFT'
  participantId: string
  name: string
}

export interface SessionEndedMessage {
  type: 'SESSION_ENDED'
  reason: 'host-left'
}

export interface PingMessage {
  type: 'PING'
  ts: number
}

export interface PongMessage {
  type: 'PONG'
  ts: number
}

// ── Chat messages ─────────────────────────────────────────────────────────────

export interface ChatTextMessage {
  type: 'CHAT_TEXT'
  id: string
  senderId: string
  senderName: string
  content: string
}

export interface ChatImageMessage {
  type: 'CHAT_IMAGE'
  id: string
  senderId: string
  senderName: string
  content: string // base64
}

export interface MessageDeletedMessage {
  type: 'MESSAGE_DELETED'
  messageId: string
  requesterId: string
}

export interface TypingMessage {
  type: 'TYPING'
  senderId: string
  senderName: string
  ts: number
}

// ── File transfer messages ────────────────────────────────────────────────────

export interface FileMetaMessage {
  type: 'FILE_META'
  transferId: string
  senderId: string
  filename: string
  totalBytes: number
}

export interface FileChunkMessage {
  type: 'FILE_CHUNK'
  transferId: string
  seq: number
  data: string // base64, ≤64 KB decoded
}

export interface FileCompleteMessage {
  type: 'FILE_COMPLETE'
  transferId: string
}

export interface FileInterruptedMessage {
  type: 'FILE_INTERRUPTED'
  transferId: string
  reason: string
}

// ── Union type ────────────────────────────────────────────────────────────────

export type WsMessage =
  | HelloMessage
  | WelcomeMessage
  | ParticipantListMessage
  | ParticipantJoinedMessage
  | ParticipantLeftMessage
  | SessionEndedMessage
  | PingMessage
  | PongMessage
  | ChatTextMessage
  | ChatImageMessage
  | MessageDeletedMessage
  | TypingMessage
  | FileMetaMessage
  | FileChunkMessage
  | FileCompleteMessage
  | FileInterruptedMessage
