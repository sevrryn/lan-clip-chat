/**
 * Unit tests for WebSocketClient
 *
 * Requirements: 3.4, 3.5, 3.6, 3.7
 *
 * These tests use a real ws.WebSocketServer on localhost to exercise the
 * WebSocketClient without any mocks, validating actual socket behaviour.
 */

import { createServer, Server } from 'http'
import { WebSocketServer as WsServer, WebSocket as WsSocket } from 'ws'
import { WebSocketClient } from '../WebSocketClient'
import type { WsMessage } from '../../shared/wsMessages'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function startServer(): Promise<{ wss: WsServer; port: number; httpServer: Server }> {
  return new Promise((resolve, reject) => {
    const httpServer = createServer()
    const wss = new WsServer({ server: httpServer })

    httpServer.listen(0, '127.0.0.1', () => {
      const addr = httpServer.address()
      if (!addr || typeof addr === 'string') {
        reject(new Error('Unexpected server address'))
        return
      }
      resolve({ wss, port: addr.port, httpServer })
    })

    httpServer.on('error', reject)
  })
}

function closeServer(wss: WsServer, httpServer: Server): Promise<void> {
  return new Promise((resolve) => {
    wss.close(() => httpServer.close(() => resolve()))
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WebSocketClient', () => {
  let wss: WsServer
  let httpServer: Server
  let port: number
  let client: WebSocketClient

  beforeEach(async () => {
    const result = await startServer()
    wss = result.wss
    httpServer = result.httpServer
    port = result.port
    client = new WebSocketClient('127.0.0.1', port)
  })

  afterEach(async () => {
    client.close()
    await closeServer(wss, httpServer)
  })

  // ── connect / open event ──────────────────────────────────────────────────

  it('resolves connect() and emits "open" when the server accepts the connection', async () => {
    const openFired = new Promise<void>((resolve) => client.once('open', resolve))
    await client.connect()
    await openFired // should already be resolved at this point
  })

  it('rejects connect() if the server is not reachable', async () => {
    const unreachableClient = new WebSocketClient('127.0.0.1', 1)
    await expect(unreachableClient.connect()).rejects.toThrow()
  })

  it('rejects connect() if already connected', async () => {
    await client.connect()
    await expect(client.connect()).rejects.toThrow('already connected')
  })

  // ── send ──────────────────────────────────────────────────────────────────

  it('send() delivers a serialised JSON message to the server', async () => {
    const received = new Promise<string>((resolve) => {
      wss.once('connection', (socket: WsSocket) => {
        socket.once('message', (data) => resolve(data.toString()))
      })
    })

    await client.connect()

    const msg: WsMessage = {
      type: 'PING',
      ts: Date.now()
    }
    client.send(msg)

    const raw = await received
    expect(JSON.parse(raw)).toMatchObject({ type: 'PING' })
  })

  it('send() is a no-op when not connected', () => {
    // Should not throw
    expect(() => {
      client.send({ type: 'PING', ts: 0 })
    }).not.toThrow()
  })

  // ── message event — valid frame ───────────────────────────────────────────

  it('emits "message" with the parsed WsMessage for a valid JSON frame', async () => {
    const messageReceived = new Promise<WsMessage>((resolve) => {
      client.once('message', resolve)
    })

    let serverSocket: WsSocket | undefined
    wss.once('connection', (socket) => {
      serverSocket = socket
    })

    await client.connect()

    // Give the server connection event a tick to fire
    await new Promise<void>((r) => setTimeout(r, 10))

    const payload: WsMessage = { type: 'PONG', ts: 42 }
    serverSocket!.send(JSON.stringify(payload))

    const msg = await messageReceived
    expect(msg).toMatchObject({ type: 'PONG', ts: 42 })
  })

  // ── message event — invalid frame dropped ────────────────────────────────

  it('does NOT emit "message" for an invalid (non-JSON) frame', async () => {
    let serverSocket: WsSocket | undefined
    wss.once('connection', (socket) => {
      serverSocket = socket
    })

    await client.connect()
    await new Promise<void>((r) => setTimeout(r, 10))

    let messageEmitted = false
    client.once('message', () => {
      messageEmitted = true
    })

    serverSocket!.send('not valid json {{{{')
    // Allow time for the message to arrive
    await new Promise<void>((r) => setTimeout(r, 50))

    expect(messageEmitted).toBe(false)
  })

  it('does NOT emit "message" for a frame missing a "type" field', async () => {
    let serverSocket: WsSocket | undefined
    wss.once('connection', (socket) => {
      serverSocket = socket
    })

    await client.connect()
    await new Promise<void>((r) => setTimeout(r, 10))

    let messageEmitted = false
    client.once('message', () => {
      messageEmitted = true
    })

    serverSocket!.send(JSON.stringify({ content: 'no type here' }))
    await new Promise<void>((r) => setTimeout(r, 50))

    expect(messageEmitted).toBe(false)
  })

  it('does NOT emit "message" for a frame exceeding 1 MiB', async () => {
    let serverSocket: WsSocket | undefined
    wss.once('connection', (socket) => {
      serverSocket = socket
    })

    // Allow large frames from the server side for this test
    const bigWss = new WsServer({ noServer: true, maxPayload: 2 * 1024 * 1024 })
    httpServer.on('upgrade', (req, socket, head) => {
      bigWss.handleUpgrade(req, socket as any, head, (ws) => {
        bigWss.emit('connection', ws, req)
      })
    })

    // Re-connect so the upgrade handler is active; in practice each test
    // already gets a fresh server so we just send via the existing connection.
    wss.once('connection', (socket) => {
      serverSocket = socket
    })

    await client.connect()
    await new Promise<void>((r) => setTimeout(r, 10))

    let messageEmitted = false
    client.once('message', () => {
      messageEmitted = true
    })

    // Build a >1 MiB JSON payload with a valid type but enormous content
    const oversized = JSON.stringify({ type: 'CHAT_TEXT', content: 'x'.repeat(1_100_000) })
    // Send raw so the ws server doesn't enforce client-side limits
    if (serverSocket) {
      serverSocket.send(oversized)
    }

    await new Promise<void>((r) => setTimeout(r, 100))

    expect(messageEmitted).toBe(false)
  })

  // ── close event ───────────────────────────────────────────────────────────

  it('emits "close" when the server closes the connection', async () => {
    const closeFired = new Promise<{ code: number; reason: string }>((resolve) => {
      client.once('close', (code, reason) => resolve({ code, reason }))
    })

    let serverSocket: WsSocket | undefined
    wss.once('connection', (socket) => {
      serverSocket = socket
    })

    await client.connect()
    await new Promise<void>((r) => setTimeout(r, 10))

    serverSocket!.close(1000, 'normal')

    const { code } = await closeFired
    expect(code).toBe(1000)
  })

  it('emits "close" when client.close() is called', async () => {
    const closeFired = new Promise<void>((resolve) => {
      client.once('close', () => resolve())
    })

    await client.connect()
    client.close()

    await closeFired
  })

  // ── error event ───────────────────────────────────────────────────────────

  it('emits "error" and rejects connect() when connection is refused', async () => {
    const badClient = new WebSocketClient('127.0.0.1', 1)
    const errors: Error[] = []
    badClient.on('error', (err) => errors.push(err))

    await expect(badClient.connect()).rejects.toThrow()
    expect(errors.length).toBeGreaterThan(0)
  })
})
