/**
 * RoomManager — orchestration layer for hosted chat rooms.
 *
 * Single source of truth for:
 *  - roomCode, hostName, participants, room status
 *  - Message history via MessageStore
 *
 * Responsibilities:
 *  - Listen to WebSocketServer events (connection, message, close)
 *  - Validate incoming frames via validation.ts
 *  - Route messages by type (HELLO, CHAT_TEXT, etc.)
 *  - Enforce participant lifecycle (join only after HELLO)
 *  - Broadcast state changes and messages
 *
 * Constraints:
 *  - Never stores raw WebSocket objects
 *  - Never duplicates socket state
 *  - Uses WebSocketServer ONLY via: send(), broadcast(), disconnect(), isAlive()
 *  - File handling is stubbed (TODO)
 *
 * Requirements: 6.2, 6.3, 6.4, 6.5, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6
 */

import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { WebSocketServer } from './WebSocketServer'
import { MessageStore } from './MessageStore'
import {
  validateName,
  validateMessageContent,
  authorizeDelete,
  validateFileSize,
} from './validation'
import type { Participant, Message } from '../shared/types'
import type {
  WsMessage,
  HelloMessage,
  ChatTextMessage,
  ChatImageMessage,
  MessageDeletedMessage,
  TypingMessage,
  FileMetaMessage,
  FileChunkMessage,
  FileCompleteMessage,
} from '../shared/wsMessages'

// ── Room state ──────────────────────────────────────────────────────────────

interface RoomState {
  roomCode: string
  hostName: string
  participants: Map<string, Participant>
  status: 'open' | 'closed'
}

// ── RoomManager ──────────────────────────────────────────────────────────────

export class RoomManager extends EventEmitter {
  private roomState: RoomState
  private messageStore: MessageStore
  private wsServer: WebSocketServer
  private hostSocketId: string

  // Track pending file transfers (stubbed for now)
  private pendingTransfers: Map<string, { senderId: string; bytes: number }> = new Map()

  /**
   * Create a new RoomManager with the host's identity.
   *
   * @param wsServer   Reference to the WebSocketServer instance
   * @param roomCode   The 6-digit room code
   * @param hostName   Display name of the host
   * @param hostSocketId Socket ID assigned by WebSocketServer
   */
  constructor(
    wsServer: WebSocketServer,
    roomCode: string,
    hostName: string,
    hostSocketId: string
  ) {
    super()

    this.wsServer = wsServer
    this.hostSocketId = hostSocketId
    this.messageStore = new MessageStore()

    // Initialize room state
    this.roomState = {
      roomCode,
      hostName,
      participants: new Map(),
      status: 'open',
    }

    // Add host as first participant
    const hostParticipant: Participant = {
      id: hostSocketId,
      name: hostName,
      isHost: true,
    }
    this.roomState.participants.set(hostSocketId, hostParticipant)

    // Register handlers with WebSocketServer
    this._registerHandlers()
  }

  // ── Public accessors ───────────────────────────────────────────────────────

  /**
   * Returns a snapshot of the current room state (read-only).
   */
  getState(): Readonly<RoomState> {
    return Object.freeze({
      roomCode: this.roomState.roomCode,
      hostName: this.roomState.hostName,
      participants: new Map(this.roomState.participants),
      status: this.roomState.status,
    })
  }

  /**
   * Returns all messages in chronological order.
   */
  getMessages(): Message[] {
    return this.messageStore.getAll()
  }

  /**
   * Returns all participants.
   */
  getParticipants(): Participant[] {
    return Array.from(this.roomState.participants.values())
  }

  /**
   * Close the room and broadcast session end.
   * Called when the host disconnects.
   */
  close(): void {
    if (this.roomState.status === 'closed') return

    this.roomState.status = 'closed'

    // Broadcast SESSION_ENDED to all remaining participants
    this.wsServer.broadcast({
      type: 'SESSION_ENDED',
      reason: 'host-left',
    })

    // Clear message history
    this.messageStore.clear()

    this.emit('closed')
  }

  // ── Handler registration ──────────────────────────────────────────────────

  private _registerHandlers(): void {
    this.wsServer.registerHandler('HELLO', (socketId, msg) => {
      this._handleHello(socketId, msg as HelloMessage)
    })

    this.wsServer.registerHandler('CHAT_TEXT', (socketId, msg) => {
      this._handleChatText(socketId, msg as ChatTextMessage)
    })

    this.wsServer.registerHandler('CHAT_IMAGE', (socketId, msg) => {
      this._handleChatImage(socketId, msg as ChatImageMessage)
    })

    this.wsServer.registerHandler('MESSAGE_DELETED', (socketId, msg) => {
      this._handleMessageDeleted(socketId, msg as MessageDeletedMessage)
    })

    this.wsServer.registerHandler('TYPING', (socketId, msg) => {
      this._handleTyping(socketId, msg as TypingMessage)
    })

    this.wsServer.registerHandler('FILE_META', (socketId, msg) => {
      this._handleFileMeta(socketId, msg as FileMetaMessage)
    })

    this.wsServer.registerHandler('FILE_CHUNK', (socketId, msg) => {
      this._handleFileChunk(socketId, msg as FileChunkMessage)
    })

    this.wsServer.registerHandler('FILE_COMPLETE', (socketId, msg) => {
      this._handleFileComplete(socketId, msg as FileCompleteMessage)
    })

    // Listen to raw connection/disconnection events for cleanup
    this.wsServer.on('connection', (socketId: string) => {
      // New connection: do nothing yet. Only add to participants after HELLO.
    })

    this.wsServer.on('disconnection', (socketId: string) => {
      this._handleDisconnection(socketId)
    })
  }

  // ── Message handlers ────────────────────────────────────────────────────────

  /**
   * HELLO: Client introduces itself and joins the room.
   * Only after a valid HELLO do we add the participant.
   */
  private _handleHello(socketId: string, msg: HelloMessage): void {
    // Ignore if room is closed
    if (this.roomState.status === 'closed') {
      this.wsServer.disconnect(socketId)
      return
    }

    // Ignore if participant already exists (duplicate HELLO)
    if (this.roomState.participants.has(socketId)) {
      return
    }

    // Validate name
    const nameValidation = validateName(msg.name)
    if (!nameValidation.valid) {
      console.warn(
        `[RoomManager] Invalid name from ${socketId}: ${nameValidation.reason}`
      )
      this.wsServer.disconnect(socketId)
      return
    }

    const trimmedName = msg.name.trim()

    // Create participant
    const participant: Participant = {
      id: socketId,
      name: trimmedName,
      isHost: false,
    }

    this.roomState.participants.set(socketId, participant)

    // Send WELCOME to the new participant with current participant list
    const welcome: WsMessage = {
      type: 'WELCOME',
      assignedId: socketId,
      participants: this.getParticipants(),
    }
    this.wsServer.send(socketId, welcome)

    // Broadcast PARTICIPANT_JOINED to all other clients
    const joined: WsMessage = {
      type: 'PARTICIPANT_JOINED',
      participant,
    }
    this.wsServer.broadcast(joined, socketId)

    this.emit('participantJoined', participant)
  }

  /**
   * CHAT_TEXT: Broadcast a text message to all participants.
   */
  private _handleChatText(socketId: string, msg: ChatTextMessage): void {
    // Verify sender is a known participant
    if (!this.roomState.participants.has(socketId)) {
      console.warn(`[RoomManager] CHAT_TEXT from unknown participant ${socketId}`)
      return
    }

    // Validate content
    if (!validateMessageContent(msg.content).valid) {
      console.warn(`[RoomManager] Invalid message content from ${socketId}`)
      return
    }

    // Create internal message record
    const record: Message = {
      id: msg.id,
      type: 'text',
      senderId: msg.senderId,
      senderName: msg.senderName,
      content: msg.content,
      receivedAt: Date.now(),
      deleted: false,
    }

    // Store and broadcast
    this.messageStore.add(record)
    this.wsServer.broadcast({
      type: 'CHAT_TEXT',
      id: msg.id,
      senderId: msg.senderId,
      senderName: msg.senderName,
      content: msg.content,
    })

    this.emit('messageReceived', record)
  }

  /**
   * CHAT_IMAGE: Broadcast an image message to all participants.
   */
  private _handleChatImage(socketId: string, msg: ChatImageMessage): void {
    // Verify sender is a known participant
    if (!this.roomState.participants.has(socketId)) {
      console.warn(`[RoomManager] CHAT_IMAGE from unknown participant ${socketId}`)
      return
    }

    // Validate content (assume content is base64-encoded image)
    if (!validateMessageContent(msg.content).valid) {
      console.warn(`[RoomManager] Invalid image content from ${socketId}`)
      return
    }

    // Create internal message record
    const record: Message = {
      id: msg.id,
      type: 'image',
      senderId: msg.senderId,
      senderName: msg.senderName,
      content: msg.content,
      receivedAt: Date.now(),
      deleted: false,
    }

    // Store and broadcast
    this.messageStore.add(record)
    this.wsServer.broadcast({
      type: 'CHAT_IMAGE',
      id: msg.id,
      senderId: msg.senderId,
      senderName: msg.senderName,
      content: msg.content,
    })

    this.emit('messageReceived', record)
  }

  /**
   * MESSAGE_DELETED: Mark a message as deleted (soft delete).
   * Only the original sender can delete their own messages.
   */
  private _handleMessageDeleted(socketId: string, msg: MessageDeletedMessage): void {
    // Verify requester is a known participant
    if (!this.roomState.participants.has(socketId)) {
      console.warn(`[RoomManager] MESSAGE_DELETED from unknown participant ${socketId}`)
      return
    }

    // Find the message
    const messages = this.messageStore.getAll()
    const target = messages.find((m) => m.id === msg.messageId)

    if (!target) {
      console.warn(`[RoomManager] MESSAGE_DELETED for non-existent message ${msg.messageId}`)
      return
    }

    // Verify authorization
    if (!authorizeDelete(msg.requesterId, target.senderId)) {
      console.warn(
        `[RoomManager] Unauthorized delete attempt by ${msg.requesterId} on message from ${target.senderId}`
      )
      return
    }

    // Mark as deleted and update store
    target.deleted = true
    this.messageStore.add(target)

    // Broadcast deletion
    this.wsServer.broadcast({
      type: 'MESSAGE_DELETED',
      messageId: msg.messageId,
      requesterId: msg.requesterId,
    })

    this.emit('messageDeleted', msg.messageId)
  }

  /**
   * TYPING: Broadcast typing indicator to all other participants.
   */
  private _handleTyping(socketId: string, msg: TypingMessage): void {
    // Verify sender is a known participant
    if (!this.roomState.participants.has(socketId)) {
      console.warn(`[RoomManager] TYPING from unknown participant ${socketId}`)
      return
    }

    // Relay typing event (usually exclude the sender)
    this.wsServer.broadcast({
      type: 'TYPING',
      senderId: msg.senderId,
      senderName: msg.senderName,
      ts: msg.ts,
    })
  }

  /**
   * FILE_META: Initiate a file transfer. Validate and announce.
   * TODO: Implement proper file transfer coordination
   */
  private _handleFileMeta(socketId: string, msg: FileMetaMessage): void {
    // Verify sender is a known participant
    if (!this.roomState.participants.has(socketId)) {
      console.warn(`[RoomManager] FILE_META from unknown participant ${socketId}`)
      return
    }

    // Validate file size
    if (!validateFileSize(msg.totalBytes)) {
      console.warn(
        `[RoomManager] FILE_META exceeds size limit from ${socketId}: ${msg.totalBytes} bytes`
      )
      this.wsServer.send(socketId, {
        type: 'FILE_INTERRUPTED',
        transferId: msg.transferId,
        reason: 'File size exceeds 900 MB limit',
      })
      return
    }

    // Track the transfer
    this.pendingTransfers.set(msg.transferId, {
      senderId: msg.senderId,
      bytes: msg.totalBytes,
    })

    // Relay to all other participants
    this.wsServer.broadcast({
      type: 'FILE_META',
      transferId: msg.transferId,
      senderId: msg.senderId,
      filename: msg.filename,
      totalBytes: msg.totalBytes,
    })
  }

  /**
   * FILE_CHUNK: Relay file chunk data. Validate size.
   * TODO: Implement chunk buffering and flow control
   */
  private _handleFileChunk(socketId: string, msg: FileChunkMessage): void {
    // Verify sender is a known participant
    if (!this.roomState.participants.has(socketId)) {
      console.warn(`[RoomManager] FILE_CHUNK from unknown participant ${socketId}`)
      return
    }

    // Verify transfer exists
    const transfer = this.pendingTransfers.get(msg.transferId)
    if (!transfer) {
      console.warn(
        `[RoomManager] FILE_CHUNK for unknown transfer ${msg.transferId} from ${socketId}`
      )
      return
    }

    // Relay to all other participants
    this.wsServer.broadcast({
      type: 'FILE_CHUNK',
      transferId: msg.transferId,
      seq: msg.seq,
      data: msg.data,
    })
  }

  /**
   * FILE_COMPLETE: Mark a file transfer as complete.
   * TODO: Implement completion validation and cleanup
   */
  private _handleFileComplete(socketId: string, msg: FileCompleteMessage): void {
    // Verify sender is a known participant
    if (!this.roomState.participants.has(socketId)) {
      console.warn(`[RoomManager] FILE_COMPLETE from unknown participant ${socketId}`)
      return
    }

    // Verify transfer exists
    const transfer = this.pendingTransfers.get(msg.transferId)
    if (!transfer) {
      console.warn(
        `[RoomManager] FILE_COMPLETE for unknown transfer ${msg.transferId} from ${socketId}`
      )
      return
    }

    // Clean up tracking
    this.pendingTransfers.delete(msg.transferId)

    // Relay to all other participants
    this.wsServer.broadcast({
      type: 'FILE_COMPLETE',
      transferId: msg.transferId,
    })
  }

  /**
   * Handle participant disconnection.
   * Remove from participants and notify others (unless it's the host).
   */
  private _handleDisconnection(socketId: string): void {
    const participant = this.roomState.participants.get(socketId)

    if (!participant) {
      // Already removed or never existed
      return
    }

    // If host disconnects, close the room
    if (participant.isHost) {
      this.close()
      return
    }

    // Remove from participants
    this.roomState.participants.delete(socketId)

    // Broadcast PARTICIPANT_LEFT
    this.wsServer.broadcast({
      type: 'PARTICIPANT_LEFT',
      participantId: socketId,
      name: participant.name,
    })

    this.emit('participantLeft', socketId, participant.name)
  }
}
