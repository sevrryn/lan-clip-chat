# RoomManager — Design Document

> Status: Design only. No implementation.  
> Scope: Host-side room lifecycle, participant tracking, and coordination between `WebSocketServer` and `DiscoveryAgent`.

---

## 1. Responsibilities

`RoomManager` is the single orchestrator for a hosted room. It owns nothing it can delegate, but it owns everything nothing else should touch.

| Responsibility | Owned by RoomManager | Delegated to |
|---|---|---|
| Room lifecycle (create / close) | ✅ | — |
| Participant list (join / leave / evict) | ✅ | — |
| Room code generation and validation | ✅ | — |
| Binding host name to the room | ✅ | — |
| Broadcasting WS frames to all/some participants | ❌ | `WebSocketServer` |
| Low-level WS socket state (open/closed/buffered) | ❌ | `WebSocketServer` |
| UDP announce / response | ❌ | `DiscoveryAgent` |
| Participant cap enforcement | ✅ | — |
| Message persistence | ❌ | `MessageStore` |
| In-flight file transfer state | ❌ | `FileTransferEngine` |
| Reconnection backoff | ❌ | `ReconnectionManager` (future) |

**In plain terms:** `RoomManager` decides *who is in the room and what the room is*. The other modules decide *how bytes move*.

---

## 2. State Ownership — Single Source of Truth

### 2a. What `RoomManager` owns exclusively

```
Participant {
  participantId:  string    // UUID v4, stable across reconnects — authoritative identity key
  socketId:       string    // current socket UUID assigned by WebSocketServer; changes on reconnect
  displayName:    string
  joinedAt:       number
  isHost:         boolean
}

PendingJoin {
  socketId:   string
  timer:      NodeJS.Timeout   // fires after 10 s if no valid JOIN frame arrives
  arrivedAt:  number
}

RoomState {
  roomCode:           string    // 6-char alphanum, generated once on create
  hostName:           string    // display name of the host
  hostParticipantId:  string    // participantId of the host
  participants:       Map<participantId, Participant>
                                // keyed by stable participantId, NOT socketId
  status:             'open' | 'closed'
  createdAt:          number    // Date.now()
  maxParticipants:    number    // enforced at JOIN; default 20
}
```

No other module holds a copy of the participant list or the room code. They receive it on demand or via event.

### 2b. What `WebSocketServer` owns exclusively

```
SocketRegistry {
  sockets: Map<socketId, WebSocket>   // live socket handles only
}
```

`WebSocketServer` knows nothing about room codes, display names, or participant roles. It only knows socket IDs and whether each socket is alive.

**Rule:** `WebSocketServer` never stores a `Participant`. `RoomManager` never stores a raw `WebSocket`.

### 2c. What `DiscoveryAgent` owns exclusively

```
DiscoveryState {
  port:      number    // the WS port to advertise
  roomCode:  string    // passed in at start, never mutated internally
}
```

`DiscoveryAgent` is stateless with respect to room membership. It holds only what it needs to answer UDP `DISCOVER` requests. It does not know how many participants have joined.

### 2d. What `MessageStore` owns exclusively

All message history. `RoomManager` invokes it to persist and retrieve messages but never caches a message itself.

### 2e. Derived / Transient — not stored anywhere

- "Is participant X still connected?" — derived by reading `participant.socketId` from the map, then calling `WebSocketServer.isAlive(socketId)`. Neither module stores a redundant boolean flag.
- Participant count visible in UI — computed from `participants.size` on demand.
- `socketId → participantId` reverse lookup — maintained as a private `Map<socketId, participantId>` inside `RoomManager`; not part of `RoomState`. Populated on JOIN, removed on socket close. Allows O(1) resolution of WSS events (which carry `socketId`) to the domain `Participant` (which is keyed by `participantId`).

---

## 3. Interaction Model

### 3a. RoomManager → WebSocketServer

`RoomManager` calls `WebSocketServer` only through a narrow interface:

```
send(socketId, frame)          // unicast to one participant
broadcast(frame, exclude?)     // multicast to all live sockets
disconnect(socketId, code, reason)  // evict a socket cleanly
isAlive(socketId): boolean     // liveness check, no side effects
```

`RoomManager` never dips into `WebSocketServer` internals. It never iterates `sockets` directly.

`WebSocketServer` emits events upward; `RoomManager` handles them:

| Event emitted by WSS | RoomManager action |
|---|---|
| `connection(socketId)` | Adds socketId to pending-join buffer with a 10-second timeout timer; waits for `JOIN` frame before creating `Participant`; disconnects with code `4008` if timer fires |
| `message(socketId, frame)` | Routes frame by `type`; dispatches to join handler, chat handler, file handler, etc. |
| `close(socketId, code)` | Removes participant from map; broadcasts `PARTICIPANT_LEFT`; notifies IpcBridge |
| `error(socketId, err)` | Logs; if socket is already closed, no-ops |

**Key rule:** `WebSocketServer` fires `connection` when the TCP handshake completes. `RoomManager` does not add the participant to its map until a valid `JOIN` frame arrives with a display name that passes validation and `participants.size < maxParticipants`. Until then the socket is connected but not a room member. If no valid `JOIN` frame arrives within 10 seconds, the pending entry is removed and the socket is disconnected with close code `4008` (`join-timeout`). If the room is full, `RoomManager` sends `JOIN_REJECT` with reason `room-full` and disconnects the socket; the participant map never exceeds `maxParticipants`.

### 3b. RoomManager → DiscoveryAgent

`RoomManager` owns the `DiscoveryAgent` instance lifecycle:

```
// on room create
discoveryAgent.start(wsPort, roomCode)

// on room close
discoveryAgent.stop()
```

That is the entire surface. `DiscoveryAgent` never calls back into `RoomManager`. Discovery is fire-and-forget from `RoomManager`'s perspective: clients that hear the UDP announce will then open a WS connection, which flows through `WebSocketServer` → `RoomManager` as a normal `connection` event.

### 3c. RoomManager → MessageStore

```
messageStore.add(message)         // after a CHAT frame is validated
messageStore.getAll(): Message[]  // on request (e.g. late joiner history sync)
```

`RoomManager` does not cache the return value of `getAll()`. It reads, sends, discards.

### 3d. RoomManager → FileTransferEngine

`RoomManager` routes file-related frames to `FileTransferEngine` and does nothing else with them. `FileTransferEngine` owns all in-flight transfer state: chunk buffers, reassembly, progress tracking, and disk writes.

```
fileTransferEngine.beginReceive(transferId, socketId, meta)  // on FILE_META
fileTransferEngine.receiveChunk(transferId, chunkIndex, data) // on FILE_CHUNK
fileTransferEngine.finalise(transferId)                       // on FILE_COMPLETE
```

`FileTransferEngine` emits events upward that `RoomManager` handles:

| FileTransferEngine event | RoomManager action |
|---|---|
| `transfer:progress(transferId, bytesReceived, totalBytes)` | Forwards to IpcBridge; no broadcast |
| `transfer:complete(transferId, message)` | Calls `messageStore.add(message)`; broadcasts `FILE_COMPLETE`; emits `transfer:complete` |
| `transfer:error(transferId, reason)` | Broadcasts `FILE_ERROR`; emits `transfer:error` |

`RoomManager` does not buffer chunks, inspect chunk contents, track progress percentages, or touch the filesystem.

### 3e. RoomManager → IpcBridge (future)

`RoomManager` emits domain events that `IpcBridge` translates into `webContents.send` calls for the renderer. `RoomManager` does not know about `BrowserWindow` or IPC channels directly.

| RoomManager event | Renderer IPC channel |
|---|---|
| `participant:joined` | `chat:participant-joined` |
| `participant:left` | `chat:participant-left` |
| `message:received` | `chat:message-received` |
| `transfer:progress` | `file:progress` |
| `transfer:complete` | `file:complete` |
| `transfer:error` | `file:error` |
| `room:closed` | `room:closed` |

---

## 4. State Duplication — Explicit Prohibitions

| Datum | Authoritative location | Must NOT appear in |
|---|---|---|
| Participant identity (`participantId`) | `RoomManager.participants` (map key) | `WebSocketServer`, `DiscoveryAgent`, `FileTransferEngine` |
| Participant display name | `RoomManager.participants` (map value) | `WebSocketServer`, `DiscoveryAgent`, `FileTransferEngine` |
| Socket handle (`WebSocket`) | `WebSocketServer.sockets` | `RoomManager`, `MessageStore`, `FileTransferEngine` |
| Room code | `RoomManager.roomState` | `WebSocketServer` |
| WS port | `DiscoveryAgent` (runtime) + `RoomManager` (passed in) | Nowhere else |
| Message history | `MessageStore` | `RoomManager`, `WebSocketServer` |
| In-flight chunk buffers / transfer state | `FileTransferEngine` | `RoomManager`, `WebSocketServer`, `MessageStore` |
| Connection liveness | `WebSocketServer` (socket state) | `RoomManager` must not mirror with its own boolean flag |

The WS port is the one value that both `RoomManager` and `DiscoveryAgent` hold. This is acceptable: `RoomManager` holds it as a scalar passed to `DiscoveryAgent.start()`; it does not duplicate discovery logic.

---

## 5. ReconnectionManager — Boundary (future)

`ReconnectionManager` lives on the **client side only**. It is not a concern of `RoomManager`.

From `RoomManager`'s perspective a reconnecting client is a brand-new `connection` event followed by a `JOIN` frame. `RoomManager` must handle this gracefully:

- On first join, `RoomManager` generates a `participantId` (UUID v4) and returns it to the client in the `JOIN_ACK` frame. The client stores this value and includes it in any future `JOIN` frame.
- On reconnect, if the `JOIN` frame carries a `participantId` that matches an existing (now-dead) participant entry, `RoomManager` reuses that `Participant` record, updates its `socketId` to the new connection's socket UUID, and sends a history slice. Identity is resolved by `participantId`, not by display name.
- If no `participantId` is present in the `JOIN` frame (e.g. first-time join or legacy client), a new `participantId` is generated and the join proceeds as normal.
- `RoomManager` must not assume socket IDs are stable across reconnects; `WebSocketServer` assigns a new UUID per connection.

`RoomManager` does not need to know whether a `JOIN` is a first join or a reconnect at the WS level. The reconnection state machine is entirely internal to `ReconnectionManager` on the client side.

---

## 6. Summary — Who Owns What

```
┌──────────────────────────────────────────────────────────────┐
│                        RoomManager                            │
│  owns: roomCode, hostName, participants Map (by participantId)│
│        hostParticipantId, status, maxParticipants             │
│  does: join logic (timeout + cap), eviction, event routing    │
│                                                               │
│   calls ──►  WebSocketServer     (send / broadcast)           │
│   calls ──►  DiscoveryAgent      (start / stop)               │
│   calls ──►  MessageStore        (add / getAll)               │
│   calls ──►  FileTransferEngine  (beginReceive / chunk / fin) │
│   emits ──►  IpcBridge           (domain events)              │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────┐   ┌──────────────────────┐
│  WebSocketServer     │   │  DiscoveryAgent       │
│  owns: socket Map    │   │  owns: port, roomCode │
│  emits events up     │   │  answers UDP only     │
└──────────────────────┘   └──────────────────────┘

┌──────────────────────┐   ┌────────────────────────────┐
│  MessageStore        │   │  FileTransferEngine         │
│  owns: all messages  │   │  owns: chunk buffers,       │
│  no events, pure API │   │  transfer state, disk writes│
└──────────────────────┘   │  emits transfer:* events up │
                            └────────────────────────────┘
```

No module reaches sideways into another module's state. All coordination flows through `RoomManager` or through events emitted upward to it.
