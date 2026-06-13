/**
 * WebSocketClient — thin wrapper around `ws.WebSocket` for the Client side.
 *
 * Responsibilities:
 *  - Store `hostIp` and `wsPort` resolved via discovery
 *  - Expose `connect(): Promise<void>` — creates a WebSocket connection and
 *    waits for the `open` event before resolving
 *  - Expose `send(msg: WsMessage): void` — serialises to JSON and sends
 *  - Expose `close(): void` — cleanly closes the connection
 *  - Emit typed Node.js EventEmitter events:
 *      'open'    — when the connection opens
 *      'message' — carrying the parsed WsMessage (invalid frames are dropped)
 *      'close'   — (code: number, reason: string) when the connection closes
 *      'error'   — (err: Error) when an error occurs
 *  - Uses `parseWsMessage()` to validate and parse every incoming frame;
 *    frames that fail validation are silently dropped (no 'message' emit)
 *
 * Requirements: 3.4, 3.5, 3.6, 3.7
 */

import { EventEmitter } from 'events'
import WebSocket from 'ws'
import type { WsMessage } from '../shared/wsMessages'
import { parseWsMessage } from './validation'

// ---------------------------------------------------------------------------
// Typed event declarations (augments EventEmitter for TypeScript callers)
// ---------------------------------------------------------------------------

export interface WebSocketClientEvents {
  open: () => void
  message: (msg: WsMessage) => void
  close: (code: number, reason: string) => void
  error: (err: Error) => void
}

declare interface WebSocketClient {
  on<K extends keyof WebSocketClientEvents>(event: K, listener: WebSocketClientEvents[K]): this
  once<K extends keyof WebSocketClientEvents>(event: K, listener: WebSocketClientEvents[K]): this
  emit<K extends keyof WebSocketClientEvents>(
    event: K,
    ...args: Parameters<WebSocketClientEvents[K]>
  ): boolean
  off<K extends keyof WebSocketClientEvents>(event: K, listener: WebSocketClientEvents[K]): this
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

class WebSocketClient extends EventEmitter {
  private readonly hostIp: string
  private readonly wsPort: number

  /** Active WebSocket instance; null when not connected. */
  private ws: WebSocket | null = null

  constructor(hostIp: string, wsPort: number) {
    super()
    this.hostIp = hostIp
    this.wsPort = wsPort
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Creates a new `ws.WebSocket` connection to `ws://hostIp:wsPort` and resolves
   * once the socket fires `open`. Rejects if the socket fires `error` before
   * `open`, or if a connection is already active.
   */
  connect(): Promise<void> {
    if (this.ws !== null) {
      return Promise.reject(new Error('WebSocketClient: already connected'))
    }

    return new Promise<void>((resolve, reject) => {
      const url = `ws://${this.hostIp}:${this.wsPort}`
      const socket = new WebSocket(url)
      this.ws = socket

      // ── one-time bootstrap handlers ───────────────────────────────────────

      const onOpen = (): void => {
        socket.removeListener('error', onInitialError)
        this._attachPersistentHandlers(socket)
        this.emit('open')
        resolve()
      }

      const onInitialError = (err: Error): void => {
        socket.removeListener('open', onOpen)
        this.ws = null
        this.emit('error', err)
        reject(err)
      }

      socket.once('open', onOpen)
      socket.once('error', onInitialError)
    })
  }

  /**
   * Serialises `msg` to JSON and sends it over the open WebSocket connection.
   * If the socket is not open, the call is a no-op (the `ReconnectionManager`
   * is responsible for queuing/re-sending during reconnection).
   */
  send(msg: WsMessage): void {
    if (this.ws === null || this.ws.readyState !== WebSocket.OPEN) {
      return
    }
    this.ws.send(JSON.stringify(msg))
  }

  /**
   * Cleanly closes the WebSocket connection. After this call the internal
   * socket reference is cleared so a subsequent `connect()` can be used for
   * reconnection.
   */
  close(): void {
    if (this.ws === null) return
    this.ws.close()
    this.ws = null
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * Attaches the long-lived event handlers to a successfully opened socket.
   * These remain in place for the lifetime of the connection.
   */
  private _attachPersistentHandlers(socket: WebSocket): void {
    socket.on('message', (data: WebSocket.RawData) => {
      // Accept Buffer or string; other shapes are rejected by parseWsMessage
      const raw: Buffer | string = Buffer.isBuffer(data)
        ? data
        : data instanceof ArrayBuffer
          ? Buffer.from(data)
          : Buffer.isBuffer(data)
            ? data
            : String(data)

      const result = parseWsMessage(raw)
      if (!result.valid) {
        // Drop invalid / oversized frames — do not emit 'message'
        return
      }
      this.emit('message', result.message)
    })

    socket.on('close', (code: number, reason: Buffer) => {
      // Clear our reference so connect() can be called again
      if (this.ws === socket) {
        this.ws = null
      }
      this.emit('close', code, reason.toString('utf8'))
    })

    socket.on('error', (err: Error) => {
      this.emit('error', err)
    })
  }
}

export { WebSocketClient }
export default WebSocketClient
