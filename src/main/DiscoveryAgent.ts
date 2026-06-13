/**
 * DiscoveryAgent — UDP-based LAN host discovery listener.
 *
 * Runs only on the Host. Binds a UDP socket on the fixed well-known port
 * 45678 and responds to DISCOVER queries from Clients with an ANNOUNCE
 * reply containing the WebSocket port and host IP address.
 *
 * Requirements: 3.4, 17.1, 17.5
 */

import * as dgram from 'dgram'
import * as os from 'os'

// ── UDP message shapes ────────────────────────────────────────────────────────

interface DiscoverMessage {
  type: 'DISCOVER'
  roomCode: string
}

interface AnnounceMessage {
  type: 'ANNOUNCE'
  roomCode: string
  wsPort: number
  hostIp: string
}

// ── Constants ─────────────────────────────────────────────────────────────────

const DISCOVERY_PORT = 45678

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Returns the first non-loopback IPv4 address of this machine, or an empty
 * string if none can be found. Used to populate `hostIp` in ANNOUNCE replies.
 */
function getLocalIp(): string {
  const interfaces = os.networkInterfaces()
  for (const iface of Object.values(interfaces)) {
    if (!iface) continue
    for (const entry of iface) {
      if (entry.family === 'IPv4' && !entry.internal) {
        return entry.address
      }
    }
  }
  return ''
}

// ── DiscoveryAgent ────────────────────────────────────────────────────────────

export class DiscoveryAgent {
  private socket: dgram.Socket | null = null
  private activeRoomCode: string | null = null
  private activeWsPort: number | null = null

  /**
   * Start listening for DISCOVER queries.
   *
   * @param roomCode  The current room code that must match incoming queries.
   * @param wsPort    The WebSocket port to advertise in ANNOUNCE replies.
   */
  start(roomCode: string, wsPort: number): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.socket !== null) {
        reject(new Error('DiscoveryAgent is already running'))
        return
      }

      this.activeRoomCode = roomCode
      this.activeWsPort = wsPort

      const socket = dgram.createSocket('udp4')
      this.socket = socket

      socket.on('error', (err) => {
        console.error('[DiscoveryAgent] Socket error:', err)
        // If the socket errored before we resolved, reject the promise
        this.socket = null
        reject(err)
      })

      socket.on('message', (msg, rinfo) => {
        this.handleMessage(msg, rinfo)
      })

      socket.bind(DISCOVERY_PORT, '0.0.0.0', () => {
        // Allow receiving broadcast packets
        try {
          socket.setBroadcast(true)
        } catch (e) {
          console.warn('[DiscoveryAgent] Could not set broadcast:', e)
        }
        console.log(`[DiscoveryAgent] Listening on UDP port ${DISCOVERY_PORT}`)
        resolve()
      })
    })
  }

  /**
   * Stop the discovery agent and unbind the UDP socket.
   */
  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.socket === null) {
        resolve()
        return
      }

      const socket = this.socket
      this.socket = null
      this.activeRoomCode = null
      this.activeWsPort = null

      socket.close(() => {
        console.log('[DiscoveryAgent] Socket closed')
        resolve()
      })
    })
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private handleMessage(msg: Buffer, rinfo: dgram.RemoteInfo): void {
    let parsed: unknown
    try {
      parsed = JSON.parse(msg.toString('utf8'))
    } catch {
      // Ignore malformed packets
      return
    }

    if (!isDiscoverMessage(parsed)) {
      return
    }

    // Only respond if the room code matches
    if (parsed.roomCode !== this.activeRoomCode) {
      return
    }

    if (this.activeWsPort === null || this.socket === null) {
      return
    }

    const hostIp = getLocalIp()
    if (!hostIp) {
      console.warn('[DiscoveryAgent] Could not determine local IP; skipping ANNOUNCE')
      return
    }

    const announce: AnnounceMessage = {
      type: 'ANNOUNCE',
      roomCode: parsed.roomCode,
      wsPort: this.activeWsPort,
      hostIp,
    }

    const reply = Buffer.from(JSON.stringify(announce), 'utf8')

    this.socket.send(reply, 0, reply.length, rinfo.port, rinfo.address, (err) => {
      if (err) {
        console.error(
          `[DiscoveryAgent] Failed to send ANNOUNCE to ${rinfo.address}:${rinfo.port}:`,
          err
        )
      } else {
        console.log(
          `[DiscoveryAgent] Sent ANNOUNCE to ${rinfo.address}:${rinfo.port} (room=${parsed.roomCode})`
        )
      }
    })
  }
}

// ── Type guard ────────────────────────────────────────────────────────────────

function isDiscoverMessage(value: unknown): value is DiscoverMessage {
  if (typeof value !== 'object' || value === null) return false
  const obj = value as Record<string, unknown>
  return obj['type'] === 'DISCOVER' && typeof obj['roomCode'] === 'string'
}
