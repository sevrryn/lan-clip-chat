/**
 * WebSocketServer — thin wrapper around the `ws` WebSocketServer class.
 *
 * Responsibilities:
 *  - Bind to `0.0.0.0` on a random port in 49152–65535
 *  - Assign a UUID v4 `socketId` to each incoming connection
 *  - Enforce the 1 MB per-message size limit via `parseWsMessage()`
 *  - Route validated messages to registered handlers by `type`
 *  - Expose `broadcast(msg, excludeId?)` and `send(socketId, msg)` helpers
 *  - Expose `start(): Promise<number>` and `stop(): Promise<void>`
 *  - Emit `connection` / `disconnection` events carrying the `socketId`
 *
 * Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6
 */

import { EventEmitter } from 'node:events'
import { createServer } from 'node:net'
import { randomUUID } from 'node:crypto'
import { WebSocketServer as WsServer, WebSocket } from 'ws'
import { parseWsMessage } from './validation'
import type { WsMessage } from '../shared/wsMessages'

// ── Port range constants ──────────────────────────────────────────────────────

const PORT_MIN = 49152
const PORT_MAX = 65535

// ── Types ─────────────────────────────────────────────────────────────────────

export type MessageHandler = (socketId: string, message: WsMessage) => void

interface TaggedSocket extends WebSocket {
  socketId: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Finds a free TCP port within the ephemeral range by attempting a bind.
 * Retries up to `maxAttempts` times before rejecting.
 */
function findFreePort(maxAttempts = 20): Promise<number> {
  return new Promise((resolve, reject) => {
    let attempts = 0

    function tryPort(): void {
      attempts++
      const port = PORT_MIN + Math.floor(Math.random() * (PORT_MAX - PORT_MIN + 1))
      const server = createServer()

      server.once('error', () => {
        server.close()
        if (attempts >= maxAttempts) {
          reject(new Error(`Could not find a free port after ${maxAttempts} attempts`))
        } else {
          tryPort()
        }
      })

      server.listen(port, '0.0.0.0', () => {
        const addr = server.address()
        const freePort = typeof addr === 'object' && addr !== null ? addr.port : port
        server.close(() => resolve(freePort))
      })
    }

    tryPort()
  })
}

// ── WebSocketServer ───────────────────────────────────────────────────────────

export class WebSocketServer extends EventEmitter {
  private wss: WsServer | null = null
  private sockets: Map<string, TaggedSocket> = new Map()
  private handlers: Map<string, MessageHandler> = new Map()

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /**
   * Starts the WebSocket server on a random free port in 49152–65535.
   * Resolves with the actual bound port number.
   */
  async start(): Promise<number> {
    const port = await findFreePort()

    return new Promise((resolve, reject) => {
      const wss = new WsServer({ host: '0.0.0.0', port })

      wss.once('error', (err) => {
        reject(err)
      })

      wss.once('listening', () => {
        this.wss = wss
        this._attachConnectionHandler()
        resolve(port)
      })
    })
  }

  /**
   * Gracefully closes all connections and stops the server.
   */
  stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.wss === null) {
        resolve()
        return
      }

      // Terminate all open sockets immediately
      for (const socket of this.sockets.values()) {
        socket.terminate()
      }
      this.sockets.clear()

      this.wss.close((err) => {
        this.wss = null
        if (err) {
          reject(err)
        } else {
          resolve()
        }
      })
    })
  }

  // ── Handler registration ──────────────────────────────────────────────────

  /**
   * Registers a handler for incoming messages of the given `type`.
   * Only one handler per type is supported; subsequent calls overwrite the previous.
   */
  registerHandler(type: string, handler: MessageHandler): void {
    this.handlers.set(type, handler)
  }

  // ── Outbound helpers ──────────────────────────────────────────────────────

  /**
   * Sends `msg` (serialised as JSON) to every connected client.
   * If `excludeId` is provided that socket is skipped.
   */
  broadcast(msg: WsMessage, excludeId?: string): void {
    const payload = JSON.stringify(msg)

    for (const [id, socket] of this.sockets) {
      if (excludeId !== undefined && id === excludeId) continue
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(payload)
      }
    }
  }

  /**
   * Sends `msg` (serialised as JSON) to the single socket identified by `socketId`.
   * Silently no-ops if the socket is not found or is no longer open.
   */
  send(socketId: string, msg: WsMessage): void {
    const socket = this.sockets.get(socketId)
    if (socket === undefined || socket.readyState !== WebSocket.OPEN) return
    socket.send(JSON.stringify(msg))
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  private _attachConnectionHandler(): void {
    if (this.wss === null) return

    this.wss.on('connection', (ws: WebSocket) => {
      const socketId = randomUUID()
      const tagged = ws as TaggedSocket
      tagged.socketId = socketId

      this.sockets.set(socketId, tagged)

      // Notify consumers that a new client connected
      this.emit('connection', socketId)

      // ── Per-message handling ────────────────────────────────────────────
      ws.on('message', (data: Buffer | string) => {
        const result = parseWsMessage(data as Buffer | string)

        if (!result.valid) {
          // Oversized or malformed frame — drop silently (warn for debugging)
          console.warn(`[WebSocketServer] Dropped invalid frame from ${socketId}`)
          return
        }

        const handler = this.handlers.get(result.message.type)
        if (handler !== undefined) {
          handler(socketId, result.message)
        }
      })

      // ── Disconnection ───────────────────────────────────────────────────
      ws.on('close', () => {
        this.sockets.delete(socketId)
        this.emit('disconnection', socketId)
      })

      // ── Error handling ──────────────────────────────────────────────────
      ws.on('error', (err) => {
        console.warn(`[WebSocketServer] Socket error on ${socketId}:`, err.message)
        // The 'close' event will fire after an error, so cleanup happens there
      })
    })
  }
}
