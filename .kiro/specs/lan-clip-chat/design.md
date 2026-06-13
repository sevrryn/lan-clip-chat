# Design Document: LAN Clip Chat

## Overview

LAN Clip Chat is a portable Windows desktop application built on **Electron + Node.js** that enables real-time text messaging, image sharing, and file transfer between users on the same LAN — with no servers, accounts, or internet access required. One peer acts as the Host, running an embedded WebSocket server; all other peers connect to that server as Clients using a 6-digit room code.

The application is packaged as a single portable Windows `.exe` using **electron-builder** with the `portable` target. No installation, no registry entries, no elevated privileges are required.

### Key Design Principles

- **Everything in-process**: The WebSocket server, file transfer engine, and discovery listener all run in the Electron main process via Node.js. No separate server binary is needed.
- **IPC as the internal API boundary**: All communication between the UI (renderer process) and application logic (main process) is routed through a typed IPC bridge exposed via Electron's `contextBridge`. The renderer never touches network primitives directly.
- **Streaming over memory**: Files are read and transmitted in fixed-size chunks using Node.js `fs.createReadStream`. The full file is never buffered in memory at once.
- **LAN-only by construction**: All sockets bind to RFC 1918 / link-local addresses; no external hostnames are resolved.

---

## Architecture

### Process Model

```
┌─────────────────────────────────────────────────────────────────┐
│                         Electron Main Process                    │
│                                                                  │
│  ┌──────────────┐   ┌───────────────────┐   ┌────────────────┐  │
│  │  RoomManager │   │  WebSocket Server  │   │ DiscoveryAgent │  │
│  │  (host only) │◄──│  (ws, host only)   │   │ (UDP dgram)    │  │
│  └──────┬───────┘   └────────┬──────────┘   └───────┬────────┘  │
│         │                    │                       │           │
│  ┌──────▼───────────────────▼───────────────────────▼────────┐  │
│  │                     IPC Bridge (ipcMain)                   │  │
│  │             Typed channels via contextBridge               │  │
│  └──────────────────────────┬────────────────────────────────┘  │
│                              │                                   │
│  ┌───────────────────────────▼──────────────────────────────┐   │
│  │              WebSocket Client (ws, client only)           │   │
│  │              ReconnectionManager                          │   │
│  │              FileTransferEngine                           │   │
│  │              MessageStore (in-memory)                     │   │
│  └──────────────────────────────────────────────────────────┘   │
└──────────────────────────────┬──────────────────────────────────┘
                               │  contextBridge / ipcRenderer
┌──────────────────────────────▼──────────────────────────────────┐
│                     Renderer Process (Chromium)                  │
│                                                                  │
│   StartupScreen  │  MainWindow  │  UIStore (state)              │
│   MessageList    │  UserPanel   │  FileProgressBar              │
└─────────────────────────────────────────────────────────────────┘
```

### Data Flow — Sending a Text Message

```
Renderer: user presses Enter
  → ipcRenderer.invoke('chat:send', { text })
  → [Main] validate, build Message object, assign id + timestamp
  → [Main / Host] ws.broadcast(JSON.stringify(wsMsg))
  → [Main / Client] wsClient.send(JSON.stringify(wsMsg))
  → Server echoes back to all participants including sender
  → [Main] parse, validate, push to MessageStore
  → ipcMain.emit('chat:message-received', msg)
  → renderer updates MessageList
```

### Data Flow — File Transfer

```
Renderer: user clicks "Send File"
  → ipcRenderer.invoke('file:pick')
  → [Main] opens native dialog, validates size ≤ 900 MB
  → [Main] creates FileTransferSession (id, meta)
  → [Main] sends ws FILE_META message (broadcast)
  → All peers: renderer shows progress UI (0%)
  → [Main] fs.createReadStream with 64 KB highWaterMark
    → on 'data': send FILE_CHUNK{transferId, seq, data: base64}
    → on 'end': send FILE_COMPLETE{transferId}
  → Receiving peer: assembles chunks to %TEMP%\lan-clip-chat\<id>
  → Progress IPC events update renderer in real time
```

---

## Components and Interfaces

### Main Process Components

#### `RoomManager`
Owns the lifecycle of the current room session on the Host side. Responsibilities:
- Generate and hold the `roomCode`
- Start/stop the `WebSocketServer`
- Start/stop the `DiscoveryAgent` (binds a UDP socket announcing the room code + WebSocket port)
- Maintain the authoritative `participants: Map<socketId, Participant>` map
- Broadcast the participant list on every join/leave event
- Handle host-initiated session-end: broadcast `SESSION_ENDED`, wait ≤ 3 s, then stop server

#### `WebSocketServer`
Thin wrapper around the `ws` `WebSocketServer` class:
- Binds to `0.0.0.0` on a randomly selected port in range `49152–65535` (assigned at room creation)
- Routes incoming messages by `type` field to registered handlers
- Exposes `broadcast(msg, excludeId?)` and `send(socketId, msg)` helpers
- Enforces the 1 MB per-message size limit (drops oversized frames before JSON parse)
- Assigns each connection a `socketId` (UUID v4) on connect

#### `DiscoveryAgent`
Runs only on the Host. Uses Node.js `dgram` to:
- Bind a UDP socket on port `45678` (fixed well-known discovery port)
- Listen for `DISCOVER` queries from clients
- Respond with `ANNOUNCE {roomCode, wsPort, hostIp}` directly to the querying client's address
- On room end, unbind the socket

#### `WebSocketClient`
Runs only on Clients. Owns the connection to the host:
- Stores `hostIp`, `wsPort` (resolved via discovery)
- Wraps `ws.WebSocket`; exposes `send(msg)`, `close()`
- Emits typed events: `message`, `open`, `close`, `error`
- Delegates reconnection to `ReconnectionManager`

#### `ReconnectionManager`
A state machine (see Reconnection section) that wraps `WebSocketClient`:
- States: `CONNECTED`, `RECONNECTING`, `DISCONNECTED`
- Drives exponential backoff; emits IPC events to update the `ConnectionStatusIndicator`
- Stops on host `SESSION_ENDED` signal or after 2 minutes total elapsed

#### `FileTransferEngine`
- One instance; handles concurrent transfers (send and receive)
- Send path: opens a `ReadStream`, slices into 64 KB chunks, sends each as a `FILE_CHUNK` WS message
- Receive path: writes arriving `FILE_CHUNK` payloads to a `WriteStream` in `%TEMP%\lan-clip-chat\<transferId>\<filename>`
- Tracks per-transfer progress (`bytesTransferred / totalBytes`); emits IPC `file:progress` events
- On `FILE_COMPLETE`: closes write stream, marks transfer done, enables Download/Open buttons
- On transfer interruption: emits `file:interrupted` IPC event

#### `MessageStore`
Simple in-memory store for the current session's messages:
- `messages: Map<string, Message>` (keyed by `id`)
- `add(msg)`, `delete(id)`, `getAll()` methods
- Not persisted to disk; cleared on session end
- Message order tracked by insertion order (chronological per requirement)

#### `IpcBridge`
Registers all `ipcMain.handle` / `ipcMain.on` channels. Acts as the only entry point from the renderer. See the IPC Bridge section for the full channel list.

### Renderer Process Components

#### `StartupScreen`
React component. Contains:
- Name input (max 50 chars, trimmed validation)
- "Create Room" button → `ipcRenderer.invoke('room:create', {name})`
- "Join Room" button → transitions to `JoinRoomDialog`

#### `JoinRoomDialog`
Modal overlay on `StartupScreen`:
- Room code input: 6 numeric digits, client-side format validation
- Triggers `ipcRenderer.invoke('room:join', {name, roomCode})`
- Shows progress/error states

#### `MainWindow`
Root layout after room join. Contains:
- `Header` (room code, Leave button, Connection Help button)
- `UserPanel` (participant list with Host suffix)
- `ChatArea` (scrollable, auto-scroll logic, `MessageList`)
- `TypingIndicator`
- `MessageInput` (textarea, Send, Send File, 500-char limit)
- `ConnectionStatusIndicator`

#### `ChatArea`
Manages scroll position:
- Auto-scrolls to bottom on new message if `userScrolledUp === false`
- Preserves position if user has manually scrolled up

#### `UIStore`
Lightweight in-process state (could use React context or Zustand):
- `participants: Participant[]`
- `messages: Message[]`
- `connectionStatus: 'connected' | 'reconnecting' | 'disconnected'`
- `typingUsers: Map<participantId, timestamp>`
- `fileTransfers: Map<transferId, FileTransferRecord>`

---

## Data Models

### `Participant`

```typescript
interface Participant {
  id: string;           // UUID assigned by server on connect
  name: string;         // Display name, 1–50 chars trimmed
  isHost: boolean;
}
```

### `Message`

```typescript
type MessageType = 'text' | 'image';

interface Message {
  id: string;                // UUID v4, assigned by sender
  type: MessageType;
  senderId: string;          // Participant.id
  senderName: string;        // Denormalized for display
  content: string;           // Text body (≤500 chars) or base64 image data
  receivedAt: number;        // unix ms timestamp, set locally on receipt
  deleted: boolean;          // soft-delete flag
}
```

### `FileTransferRecord`

```typescript
type FileTransferStatus = 'pending' | 'in-progress' | 'complete' | 'interrupted';

interface FileTransferRecord {
  id: string;               // UUID v4
  filename: string;
  totalBytes: number;
  bytesTransferred: number;
  status: FileTransferStatus;
  senderId: string;
  localPath?: string;       // Set on receiver when download is available
  startedAt: number;        // unix ms
}
```

### `RoomState`

```typescript
interface RoomState {
  roomCode: string;           // 6-digit zero-padded string
  localParticipantId: string;
  isHost: boolean;
  wsPort: number;             // Ephemeral port (49152–65535)
}
```

### `ConnectionState`

```typescript
type ConnectionState = 'connected' | 'reconnecting' | 'disconnected';
```

---

## WebSocket Message Protocol

All messages are JSON objects with a required `type: string` field. Maximum serialized size: 1 MB. The server validates `type` presence and discards any non-conforming frames.

### Control Messages

| Type | Direction | Payload Fields |
|------|-----------|----------------|
| `HELLO` | Client → Server | `participantId: string`, `name: string` |
| `WELCOME` | Server → Client | `participants: Participant[]`, `assignedId: string` |
| `PARTICIPANT_LIST` | Server → All | `participants: Participant[]` |
| `PARTICIPANT_JOINED` | Server → All | `participant: Participant` |
| `PARTICIPANT_LEFT` | Server → All | `participantId: string`, `name: string` |
| `SESSION_ENDED` | Server → All | `reason: 'host-left'` |
| `PING` | Either | `ts: number` |
| `PONG` | Either | `ts: number` |

### Chat Messages

| Type | Direction | Payload Fields |
|------|-----------|----------------|
| `CHAT_TEXT` | Client → Server → All | `id: string`, `senderId: string`, `senderName: string`, `content: string` |
| `CHAT_IMAGE` | Client → Server → All | `id: string`, `senderId: string`, `senderName: string`, `content: string` (base64) |
| `MESSAGE_DELETED` | Client → Server → All | `messageId: string`, `requesterId: string` |
| `TYPING` | Client → Server → Others | `senderId: string`, `senderName: string`, `ts: number` |

### File Transfer Messages

| Type | Direction | Payload Fields |
|------|-----------|----------------|
| `FILE_META` | Client → Server → All | `transferId: string`, `senderId: string`, `filename: string`, `totalBytes: number` |
| `FILE_CHUNK` | Client → Server → All | `transferId: string`, `seq: number`, `data: string` (base64, ≤64 KB decoded) |
| `FILE_COMPLETE` | Client → Server → All | `transferId: string` |
| `FILE_INTERRUPTED` | Client → Server → All | `transferId: string`, `reason: string` |

### Message Validation Rules (enforced server-side and client-side)

1. Frame size > 1 MB → discard, log warning
2. Not valid JSON → discard
3. Missing `type` field or `type` not a string → discard
4. `CHAT_TEXT.content` empty, whitespace-only, or > 500 chars → discard
5. `MESSAGE_DELETED` — server checks that `requesterId` matches the `senderId` stored with the message; rejects otherwise
6. `FILE_META.totalBytes` > 900 MB → server sends `FILE_INTERRUPTED` back to sender immediately and does not broadcast `FILE_META`
7. `HELLO.name` fails validation → server closes the connection with code 4400

---

## LAN Host Discovery

### Problem

A Client has a 6-digit room code but needs to find the Host's IP address and WebSocket port on the LAN.

### Solution: UDP Broadcast + Room Code Matching

The Host runs a **DiscoveryAgent** that listens on a fixed UDP port (`45678`). When a Client wants to join:

```
Client                                  Host
  │                                       │
  │──── UDP broadcast 255.255.255.255 ───►│
  │     DISCOVER { roomCode: "482915" }   │
  │                                       │
  │◄─── UDP unicast ──────────────────────│
  │     ANNOUNCE { roomCode, wsPort,      │
  │                hostIp }               │
  │                                       │
  │──── WebSocket ws://hostIp:wsPort ────►│
  │     HELLO { participantId, name }     │
```

**Discovery flow in detail:**

1. Client serializes `{ type: 'DISCOVER', roomCode }` as JSON and sends it as a UDP broadcast to `255.255.255.255:45678` (or the subnet broadcast address calculated from local network interfaces).
2. Host's `DiscoveryAgent` receives the packet, compares `roomCode` against its active room, and if matched replies with `{ type: 'ANNOUNCE', roomCode, wsPort, hostIp }` as a UDP unicast back to `rinfo.address:rinfo.port`.
3. Client receives `ANNOUNCE`, extracts `hostIp` and `wsPort`, then opens the WebSocket connection.
4. If no `ANNOUNCE` arrives within 10 seconds, the discovery attempt is considered failed (Requirement 3.7).

**Multiple network interfaces:** The Host binds the UDP socket to `0.0.0.0` (all interfaces) so it receives broadcasts on any active LAN adapter. The `hostIp` in the `ANNOUNCE` reply is the source IP of the UDP socket as seen from the responding interface.

**Firewall note:** The discovery port (`45678`) and the WebSocket port must both be reachable within the LAN. The "Connection Help" dialog explains how to add firewall exceptions for these ports.

### Why Not mDNS/Bonjour?

mDNS (via packages like `bonjour`) requires native add-ons that complicate packaging into a single portable `.exe` and have additional Windows Firewall requirements beyond a simple UDP socket. A plain `dgram` UDP broadcast achieves the same room-code-based discovery with zero extra dependencies.

---

## File Transfer Architecture

### Chunked Streaming

Files are never loaded entirely into memory. The `FileTransferEngine` uses Node.js `ReadStream`:

```
ReadStream (64 KB highWaterMark)
  → 'data' event → base64-encode chunk → send FILE_CHUNK over WS
  → 'end' event  → send FILE_COMPLETE
  → 'error' event → send FILE_INTERRUPTED, emit IPC event to renderer
```

A 64 KB chunk size balances throughput on a typical LAN (≥100 Mbps) with message overhead. At this size, a 900 MB file produces ~14,400 chunks.

### Off-Main-Thread Strategy

File I/O must not block the UI (Requirement 11.5). The `FileTransferEngine` lives in the **main process**, which is already separate from the renderer's V8 thread. Node.js I/O is non-blocking by default via libuv. For the WebSocket send loop, back-pressure is managed by checking `ws.bufferedAmount` before sending each chunk; if the buffer is above a threshold (e.g., 4 MB), the stream is paused until the buffer drains.

### Receive Side

Incoming `FILE_CHUNK` messages are accumulated in `%TEMP%\lan-clip-chat\<transferId>\`:

```
FileTransferEngine.receive
  FILE_META  → create WriteStream to temp path, register in transferMap
  FILE_CHUNK → write chunk.data (decoded from base64) to stream, emit progress IPC
  FILE_COMPLETE → close stream, set status = 'complete', emit IPC
  FILE_INTERRUPTED → close+delete partial file, emit IPC
```

The `Download` button copies the temp file to a user-chosen destination. The `Open` button launches the file with the OS default handler (`shell.openPath`). Temp files are deleted on application exit (Requirement 18.4).

### Progress Tracking

Each `FILE_CHUNK` carries a `seq` number. The receiver tracks `bytesTransferred += chunkSize` and emits `file:progress { transferId, bytesTransferred, totalBytes }` IPC events at most once per 100 ms to avoid flooding the renderer.

### Concurrent Transfers

The `FileTransferEngine` keeps a `Map<transferId, TransferSession>` for concurrent in-flight transfers in both directions. Each session has its own `ReadStream` or `WriteStream`; they are independent.

---

## Reconnection Strategy

Reconnection applies only to **Clients**. The Host cannot reconnect to itself — if the host process crashes, the session is over.

### State Machine

```
          connect()
              │
              ▼
         ┌─────────┐
    ┌───►│CONNECTED│◄──────────── reconnect succeeds
    │    └────┬────┘
    │         │ connection lost (non-intentional close)
    │         ▼
    │   ┌──────────────┐
    │   │ RECONNECTING │
    │   └──────┬───────┘
    │          │
    │   ┌──────▼────────────────┐
    │   │ Exponential backoff   │
    │   │ attempt #n:           │
    │   │   delay = min(         │
    │   │     1s * 2^(n-1),     │
    │   │     30s               │
    │   │   )                   │
    │   └──────┬────────────────┘
    │          │
    │     attempt succeeds? ──yes──► CONNECTED
    │          │ no
    │     elapsed > 2 min? ──yes──► DISCONNECTED
    │          │ no
    │     retry (loop)
    │
    │   Server sends SESSION_ENDED?
    │     → stop retrying, show "Session ended by host.", nav to Startup
    │
  intentional
   leave()
              │
              ▼
         close WebSocket
         return to Startup
```

### Backoff Schedule

| Attempt | Delay |
|---------|-------|
| 1 | 1 s |
| 2 | 2 s |
| 3 | 4 s |
| 4 | 8 s |
| 5 | 16 s |
| 6+ | 30 s (cap) |

Total time to exhaustion (≥ 2 minutes): approximately 2 minutes 1 second at the cap, satisfying Requirement 15.4.

### Reconnect Behavior

On successful reconnect, the Client re-sends a `HELLO` message. The server adds the participant back to the room and broadcasts `PARTICIPANT_LIST` to all peers. The client's local `MessageStore` is preserved across the reconnect so chat history is not lost.

---

## IPC Bridge Design

The preload script exposes a typed `window.electronAPI` object via `contextBridge.exposeInMainWorld`. The renderer only calls methods on this object; it never uses `ipcRenderer` directly.

### Channel Conventions

- `invoke` (request/response): renderer calls, main process handles, returns a Promise
- `on` (push): main process pushes events to renderer via `webContents.send`

### Exposed API (preload → renderer)

```typescript
interface ElectronAPI {
  // Session
  createRoom(name: string): Promise<{ roomCode: string } | { error: string }>;
  joinRoom(name: string, roomCode: string): Promise<{ ok: true } | { error: string }>;
  leaveRoom(): Promise<void>;

  // Chat
  sendMessage(text: string): Promise<{ ok: true } | { error: string }>;
  sendImage(base64: string): Promise<{ ok: true } | { error: string }>;
  deleteMessage(messageId: string): Promise<void>;
  sendTyping(): Promise<void>;

  // File
  pickAndSendFile(): Promise<{ transferId: string } | { error: string }>;
  downloadFile(transferId: string, destPath: string): Promise<void>;
  openFile(transferId: string): Promise<void>;

  // Event subscriptions (returns unsubscribe fn)
  onMessageReceived(cb: (msg: Message) => void): () => void;
  onMessageDeleted(cb: (messageId: string) => void): () => void;
  onParticipantList(cb: (participants: Participant[]) => void): () => void;
  onTyping(cb: (senderId: string, senderName: string) => void): () => void;
  onFileProgress(cb: (record: FileTransferRecord) => void): () => void;
  onConnectionStatus(cb: (status: ConnectionState) => void): () => void;
  onSessionEnded(cb: () => void): () => void;
}
```

All `on*` methods register an `ipcRenderer.on` listener inside the preload and return a cleanup function. The renderer calls the cleanup function on component unmount to prevent listener leaks.

### Security

- `contextIsolation: true` (default in modern Electron)
- `nodeIntegration: false` (renderer cannot access Node APIs directly)
- `sandbox: false` (main process needs full Node access; preload runs in the main world with contextBridge isolation)

---

## Electron Packaging Approach

### Target

`electron-builder` with `win` target `portable`. This produces a single self-contained `.exe` that extracts to `%APPDATA%\Local\Temp\<app-name>` on first run and uses a cached extraction on subsequent runs, avoiding the slow re-extraction startup penalty documented in known electron-builder issues.

### Build Configuration (`electron-builder.yml`)

```yaml
appId: com.lan-clip-chat.app
productName: LAN Clip Chat
directories:
  output: dist
win:
  target:
    - target: portable
      arch: [x64]
  requestedExecutionLevel: asInvoker   # No UAC elevation required
portable:
  artifactName: LanClipChat.exe
  unpackDirName: lan-clip-chat
  useZip: false
files:
  - dist/main/**
  - dist/preload/**
  - dist/renderer/**
  - node_modules/**
  - package.json
asar: true                              # Bundle app code into ASAR archive
asarUnpack:
  - node_modules/ws/**                  # ws uses native addons that must remain unpacked
```

### Temp File Cleanup

On `app.on('before-quit')`, the main process deletes `%TEMP%\lan-clip-chat\` recursively using `fs.rmSync(..., { recursive: true, force: true })`. This satisfies Requirement 18.4 while leaving any user-explicitly-saved files untouched.

### No Admin Privileges

The `requestedExecutionLevel: asInvoker` setting ensures Windows never shows a UAC prompt as long as the `.exe` is run from a user-writable path. The application does not write to `Program Files` or `HKLM` registry keys.

---

## Error Handling

| Scenario | Handling |
|----------|----------|
| WebSocket server fails to bind | IPC error → renderer shows error, stays on Startup |
| Host's UDP socket fails to bind | Log warning, skip discovery; users must enter IP manually (future enhancement) |
| Client UDP discovery times out (10 s) | `joinRoom` rejects with `{ error: 'timeout' }` → renderer shows "Host not found" |
| WebSocket connection refused/rejected | `joinRoom` rejects with reason string |
| Message JSON parse failure | Discard + `console.warn` with frame prefix |
| Message missing `type` | Discard + `console.warn` |
| Message > 1 MB | Discard before parse |
| File > 900 MB | Reject in main before opening ReadStream; renderer shows error |
| File read error mid-transfer | Send `FILE_INTERRUPTED`, close stream, emit IPC |
| File write error mid-receive | Emit `file:interrupted` IPC; clean up partial file |
| Reconnection exhausted (2 min) | Show "● Disconnected"; stop retrying |
| Session ended by host during reconnect | Show "Session ended by host."; return to Startup |
| Message send fails (WS not open) | IPC returns `{ error }`, renderer shows inline error, retains input |

---

## Testing Strategy

### Unit Tests (Jest + fast-check)

Unit tests cover pure logic in the main process that does not require Electron or network infrastructure. The testing approach is **dual**: example-based tests for specific behaviors and property-based tests for universal correctness properties.

**Property-based testing library**: [fast-check](https://fast-check.dev/) — runs with Jest, works in Node.js without a browser, and supports TypeScript natively.

**Configuration**: Each property test runs a minimum of **100 iterations** (`numRuns: 100`).

**Tag format**: Each property test is annotated with a comment:
```
// Feature: lan-clip-chat, Property N: <property text>
```

**Property tests to implement:**

| Property | Test Target | fast-check Arbitraries |
|---|---|---|
| P1 — Name validation invariant | `validateName()` | `fc.string()` (whitespace-only variants + length extremes) |
| P2 — Room code format invariant | `validateRoomCode()` + `generateRoomCode()` | `fc.string()`, `fc.integer({min:0, max:999999})` |
| P3 — 1 MiB message size gate | `parseWsMessage()` | `fc.uint8Array({minLength:1048577})` |
| P4 — Message validation totality | `parseWsMessage()` | `fc.string()` (arbitrary bytes) |
| P5 — Text content gate | `validateMessageContent()` | `fc.string({minLength:0, maxLength:600})` |
| P6 — Deletion authorization | `authorizeDelete()` | `fc.uuid()` pairs where ids differ |
| P7 — Back-off schedule + termination | `computeBackoffDelay(n)` | `fc.integer({min:0, max:30})` |
| P8 — File size gate | `validateFileSize()` | `fc.bigInt({min:0n})` above/below threshold |
| P9 — Chunk round-trip | `splitChunks()` + `assembleChunks()` | `fc.uint8Array({maxLength:65536*20})` |
| P10 — Typing throttle | `ThrottledTypingSender` | `fc.array(fc.integer({min:0, max:5000}))` (keystroke timestamps) |
| P11 — Clipboard routing priority | `resolveClipboardAction()` | `fc.record({hasText: fc.boolean(), hasImage: fc.boolean()})` |

### Integration Tests

- WebSocket server start/stop lifecycle
- Round-trip: send a message, verify server broadcasts it to all connected mock clients
- Room code generation: verify format (`/^\d{6}$/`) and statistical distribution
- File transfer: send a small binary file through the engine, verify received bytes match
- Deletion authorization enforcement: two mock clients — verify cross-client deletion is rejected by server

### Areas explicitly NOT tested with PBT

- UI rendering — snapshot tests instead
- Discovery UDP socket behavior — integration test with local loopback
- electron-builder packaging — smoke test: verify `.exe` starts, shows Startup_Screen
- LAN-only network constraint — Wireshark/mock proxy verification during integration testing

---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

The properties below are derived from the requirements' acceptance criteria. Each is universally quantified and intended to be implemented as a property-based test using **fast-check** (minimum 100 iterations per property).

---

### Property 1: Name validation invariant

*For any* string used as a display name, the name is valid if and only if its trimmed form has length
between 1 and 50 characters inclusive. Any string that is entirely whitespace (trimmed length = 0) SHALL
be rejected. Any string whose trimmed form exceeds 50 characters SHALL be rejected. All other strings
SHALL be accepted.

**Validates: Requirements 1.3, 1.4**

---

### Property 2: Room code format invariant

*For any* string submitted as a room code, the application SHALL accept it if and only if it matches
`/^\d{6}$/` (exactly 6 ASCII decimal digits), and SHALL reject all other strings without attempting a
connection. Additionally, *for any* integer in the range [0, 999999], the generated room code string
SHALL be exactly 6 characters long, zero-padded on the left as needed.

**Validates: Requirements 2.3, 3.2, 3.3**

---

### Property 3: Incoming message size gate never crashes

*For any* incoming WebSocket payload whose byte length exceeds 1 048 576 bytes (1 MiB), the validator
SHALL return `{ valid: false }` without throwing an exception, and the application SHALL continue
processing subsequent messages normally.

**Validates: Requirements 14.5, 14.6**

---

### Property 4: Message structural validation is total and never throws

*For any* byte sequence or string presented as an incoming WebSocket message, `parseWsMessage()` SHALL
return a result object and SHALL never throw. It SHALL return `{ valid: false }` for all inputs that
are not valid JSON, lack a `type` field, or have a `type` field that is not of type string.

**Validates: Requirements 14.1, 14.2, 14.3, 14.4, 14.6**

---

### Property 5: Text message content gate

*For any* string value used as message content, `validateMessageContent()` SHALL return valid if and only
if the string is non-empty after trimming AND its length is ≤ 500 characters. It SHALL return invalid
for empty, whitespace-only, absent, or >500-character values, on both the client side and the server
side.

**Validates: Requirements 8.2, 8.3, 8.9**

---

### Property 6: Deletion authorization gate

*For any* deletion request, `authorizeDelete()` SHALL return true if and only if the requesting
participant's `connectionId` matches the stored owner of the given `msgId`. *For any* pair
(requesterId, ownerId) where requesterId ≠ ownerId, the function SHALL return false and no broadcast
SHALL occur.

**Validates: Requirements 12.7**

---

### Property 7: Reconnection back-off schedule and termination

*For any* non-negative integer attempt index `n`, the back-off delay SHALL equal
`min(1000 × 2^n, 30 000)` ms, be non-decreasing with increasing `n`, and never exceed 30 000 ms.
The cumulative sum of delays for all attempts SHALL eventually exceed 120 000 ms (2 minutes), at which
point the ReconnectionManager SHALL stop scheduling further attempts.

**Validates: Requirements 15.2, 15.4**

---

### Property 8: File transfer size gate

*For any* file whose size in bytes exceeds 943 718 400 (900 × 1 024 × 1 024), `validateFileSize()`
SHALL return false, the transfer SHALL be rejected with an error, and no `FILE_CHUNK` message SHALL be
transmitted. For any file at or below the threshold, the transfer SHALL proceed.

**Validates: Requirements 11.3, 11.4**

---

### Property 9: Chunked file assembly round-trip

*For any* byte array of length ≤ 943 718 400 bytes, splitting the array into sequential 64 KiB chunks
and concatenating those chunks in order SHALL produce a byte sequence identical to the original input.

**Validates: Requirements 11.2**

---

### Property 10: Typing event throttle

*For any* sequence of input-field keystroke events, the number of `TYPING` messages emitted to the
server within any contiguous 2-second window SHALL be at most 1.

**Validates: Requirements 9.1**

---

### Property 11: Clipboard routing — text presence determines action

*For any* clipboard state, if the clipboard contains plain text (regardless of whether an image is also
present), the Ctrl+V handler SHALL insert the text into the input field and SHALL NOT send an image
message. Only when the clipboard contains an image and no plain text SHALL the image-send path be taken.

**Validates: Requirements 10.2, 10.3**

