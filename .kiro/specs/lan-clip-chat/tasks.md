# Implementation Plan: LAN Clip Chat

## Overview

Build a portable Electron + Node.js Windows desktop application for LAN-based real-time text, image, and file sharing. The implementation follows a layered approach: project scaffold → main process core → IPC bridge → renderer UI → packaging. All major components map directly to the architecture in the design document.

---

## Tasks

- [x] 1. Project scaffold and build configuration
  - [x] 1.1 Initialise Electron + TypeScript project structure
    - Create `package.json` with `electron`, `typescript`, `ts-node`, `webpack`/`vite` for renderer bundle, `ws`, and `fast-check` + `jest` for tests
    - Add `tsconfig.json` (strict mode, separate configs for main, preload, renderer)
    - Create `src/main/`, `src/preload/`, `src/renderer/` directory tree
    - Add `.gitignore`, `jest.config.ts`, and `electron.vite.config.ts` (or equivalent bundler config)
    - _Requirements: 18.1, 18.2_

  - [x] 1.2 Configure electron-builder for portable `.exe`
    - Add `electron-builder.yml` with `portable` win target, `asar: true`, `asarUnpack` for the `ws` module, `requestedExecutionLevel: asInvoker`
    - Add `build` and `package` npm scripts
    - _Requirements: 18.1, 18.2, 18.3_

- [x] 2. Core TypeScript types and shared utilities
  - [x] 2.1 Define shared data model interfaces and WS message types
    - Write `src/shared/types.ts`: `Participant`, `Message`, `MessageType`, `FileTransferRecord`, `FileTransferStatus`, `RoomState`, `ConnectionState`
    - Write `src/shared/wsMessages.ts`: discriminated union of all WS message shapes (HELLO, WELCOME, PARTICIPANT_LIST, PARTICIPANT_JOINED, PARTICIPANT_LEFT, SESSION_ENDED, PING, PONG, CHAT_TEXT, CHAT_IMAGE, MESSAGE_DELETED, TYPING, FILE_META, FILE_CHUNK, FILE_COMPLETE, FILE_INTERRUPTED)
    - _Requirements: 8.1, 11.2, 14.1_

  - [x] 2.2 Implement validation utility functions
    - Write `src/main/validation.ts`: `validateName(s: string)`, `validateRoomCode(s: string)`, `generateRoomCode()`, `parseWsMessage(raw: Buffer | string)`, `validateMessageContent(s: string)`, `authorizeDelete(requesterId: string, ownerId: string)`, `validateFileSize(bytes: bigint | number)`, `computeBackoffDelay(attempt: number)`
    - Each function must be pure and handle all edge cases described in the design
    - _Requirements: 1.3, 1.4, 2.3, 3.2, 3.3, 8.2, 8.3, 8.9, 12.7, 14.1–14.6, 15.2, 15.4_

  - [ ]* 2.3 Write property test — P1: Name validation invariant
    - **Property 1: Name validation invariant** — For any string, `validateName()` returns valid iff trimmed length is 1–50
    - **Validates: Requirements 1.3, 1.4**
    - Use `fc.string()` including whitespace-only and length-extreme arbitraries; min 100 runs
    - Annotate: `// Feature: lan-clip-chat, Property 1: Name validation invariant`

  - [ ]* 2.4 Write property test — P2: Room code format invariant
    - **Property 2: Room code format invariant** — `validateRoomCode()` accepts iff input matches `/^\d{6}$/`; `generateRoomCode()` always produces a 6-char zero-padded string
    - **Validates: Requirements 2.3, 3.2, 3.3**
    - Use `fc.string()` and `fc.integer({min: 0, max: 999999})`; min 100 runs
    - Annotate: `// Feature: lan-clip-chat, Property 2: Room code format invariant`

  - [ ]* 2.5 Write property test — P3: Incoming message size gate never crashes
    - **Property 3: Incoming message size gate never crashes** — For any payload > 1 MiB, `parseWsMessage()` returns `{ valid: false }` without throwing
    - **Validates: Requirements 14.5, 14.6**
    - Use `fc.uint8Array({minLength: 1048577})`; min 100 runs
    - Annotate: `// Feature: lan-clip-chat, Property 3: Incoming message size gate never crashes`

  - [ ]* 2.6 Write property test — P4: Message structural validation is total and never throws
    - **Property 4: Message structural validation is total and never throws** — For any byte sequence, `parseWsMessage()` never throws and returns `{ valid: false }` for non-JSON, missing `type`, or non-string `type`
    - **Validates: Requirements 14.1, 14.2, 14.3, 14.4, 14.6**
    - Use `fc.string()` (arbitrary bytes); min 100 runs
    - Annotate: `// Feature: lan-clip-chat, Property 4: Message structural validation is total and never throws`

  - [ ]* 2.7 Write property test — P5: Text message content gate
    - **Property 5: Text message content gate** — `validateMessageContent()` returns valid iff string is non-empty after trimming AND length ≤ 500
    - **Validates: Requirements 8.2, 8.3, 8.9**
    - Use `fc.string({minLength: 0, maxLength: 600})`; min 100 runs
    - Annotate: `// Feature: lan-clip-chat, Property 5: Text message content gate`

  - [ ]* 2.8 Write property test — P6: Deletion authorization gate
    - **Property 6: Deletion authorization gate** — For any pair `(requesterId, ownerId)` where `requesterId ≠ ownerId`, `authorizeDelete()` returns `false`
    - **Validates: Requirements 12.7**
    - Use `fc.uuid()` pairs guaranteed to differ; min 100 runs
    - Annotate: `// Feature: lan-clip-chat, Property 6: Deletion authorization gate`

  - [ ]* 2.9 Write property test — P7: Reconnection back-off schedule and termination
    - **Property 7: Reconnection back-off schedule and termination** — For any non-negative integer `n`, `computeBackoffDelay(n)` equals `min(1000 × 2^n, 30000)` ms and is non-decreasing; cumulative sum eventually exceeds 120 000 ms
    - **Validates: Requirements 15.2, 15.4**
    - Use `fc.integer({min: 0, max: 30})`; min 100 runs
    - Annotate: `// Feature: lan-clip-chat, Property 7: Reconnection back-off schedule and termination`

- [x] 3. Checkpoint — Core utilities
  - Ensure all property tests from task 2 pass with `npx jest --testPathPattern=validation`, ask the user if questions arise.

- [x] 4. Main process — MessageStore
  - [x] 4.1 Implement `MessageStore`
    - Write `src/main/MessageStore.ts` with `messages: Map<string, Message>`, `add(msg)`, `delete(id)`, `getAll()` methods
    - Store maintains insertion order; cleared on session end
    - _Requirements: 8.4, 8.5, 8.6, 12.6_

- [ ] 5. Main process — WebSocketServer
  - [-] 5.1 Implement `WebSocketServer` wrapper
    - Write `src/main/WebSocketServer.ts` wrapping the `ws` `WebSocketServer` class
    - Bind to `0.0.0.0` on a random port in `49152–65535`
    - Assign `socketId` (UUID v4) to each connection on `connect`
    - Enforce 1 MB per-message size limit (drop oversized frames before JSON parse)
    - Implement `broadcast(msg, excludeId?)` and `send(socketId, msg)` helpers
    - Route incoming messages by `type` to registered handlers
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6_

  - [ ]* 5.2 Write unit tests for WebSocketServer message routing and size gate
    - Test that frames > 1 MB are dropped without crashing
    - Test that broadcast reaches all connected mock clients
    - Test that `excludeId` correctly omits one peer
    - _Requirements: 14.5, 14.6_

- [ ] 6. Main process — DiscoveryAgent
  - [-] 6.1 Implement `DiscoveryAgent`
    - Write `src/main/DiscoveryAgent.ts` using Node.js `dgram`
    - Bind UDP socket on port `45678` on `0.0.0.0`
    - Respond with `ANNOUNCE { roomCode, wsPort, hostIp }` unicast on matching `DISCOVER` query
    - Unbind socket cleanly on `stop()`
    - _Requirements: 3.4, 17.1, 17.5_

- [ ] 7. Main process — WebSocketClient and ReconnectionManager
  - [ ] 7.1 Implement `WebSocketClient`
    - Write `src/main/WebSocketClient.ts` wrapping `ws.WebSocket`
    - Store `hostIp`, `wsPort`; expose `send(msg)`, `close()`
    - Emit typed events: `message`, `open`, `close`, `error`
    - _Requirements: 3.4, 3.5, 3.6, 3.7_

  - [~] 7.2 Implement `ReconnectionManager` state machine
    - Write `src/main/ReconnectionManager.ts` with states `CONNECTED`, `RECONNECTING`, `DISCONNECTED`
    - Drive exponential back-off using `computeBackoffDelay(n)` (from `validation.ts`)
    - Emit IPC events on state transitions to update `ConnectionStatusIndicator`
    - Stop on `SESSION_ENDED` or after 2 minutes elapsed
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5_

  - [ ]* 7.3 Write unit tests for ReconnectionManager state transitions
    - Test `CONNECTED → RECONNECTING` on unexpected close
    - Test back-off delay sequence for attempts 1–6
    - Test `RECONNECTING → DISCONNECTED` after 2-minute exhaustion
    - Test `RECONNECTING → Startup` on `SESSION_ENDED`
    - _Requirements: 15.1, 15.2, 15.4, 15.5_

- [ ] 8. Main process — FileTransferEngine
  - [~] 8.1 Implement `FileTransferEngine` — send path
    - Write `src/main/FileTransferEngine.ts`
    - Validate file size ≤ 900 MB via `validateFileSize()` before opening any stream
    - Open `fs.createReadStream` with `highWaterMark: 65536` (64 KB)
    - On each `data` event: base64-encode chunk, send `FILE_CHUNK { transferId, seq, data }` WS message
    - Check `ws.bufferedAmount`; pause stream if buffer > 4 MB, resume on drain
    - On `end`: send `FILE_COMPLETE`; on `error`: send `FILE_INTERRUPTED`, emit IPC
    - _Requirements: 11.2, 11.3, 11.4, 11.5_

  - [~] 8.2 Implement `FileTransferEngine` — receive path and progress tracking
    - Handle `FILE_META`: create `WriteStream` in `%TEMP%\lan-clip-chat\<transferId>\<filename>`
    - Handle `FILE_CHUNK`: decode base64, write to stream, emit `file:progress` IPC (throttled to 1 event/100 ms)
    - Handle `FILE_COMPLETE`: close stream, set status `complete`, emit IPC
    - Handle `FILE_INTERRUPTED`: close and delete partial file, emit IPC
    - Track `Map<transferId, TransferSession>` for concurrent transfers
    - _Requirements: 11.2, 11.6, 11.7, 11.10_

  - [ ]* 8.3 Write property test — P8: File size gate
    - **Property 8: File transfer size gate** — `validateFileSize()` returns `false` for any value > 943 718 400 bytes
    - **Validates: Requirements 11.3, 11.4**
    - Use `fc.bigInt({min: 0n})` above and below threshold; min 100 runs
    - Annotate: `// Feature: lan-clip-chat, Property 8: File transfer size gate`

  - [ ]* 8.4 Write property test — P9: Chunked file assembly round-trip
    - **Property 9: Chunked file assembly round-trip** — For any byte array, splitting into 64 KiB chunks and concatenating produces the original
    - **Validates: Requirements 11.2**
    - Extract `splitChunks(buf: Buffer): Buffer[]` and `assembleChunks(chunks: Buffer[]): Buffer` as pure helpers in `FileTransferEngine.ts` so they can be imported directly by the test
    - Use `fc.uint8Array({maxLength: 65536 * 20})`; min 100 runs
    - Annotate: `// Feature: lan-clip-chat, Property 9: Chunked file assembly round-trip`

  - [ ]* 8.5 Write unit tests for FileTransferEngine concurrent transfers
    - Test two simultaneous send sessions do not interleave each other's chunks
    - Test partial receive cleanup on `FILE_INTERRUPTED`
    - _Requirements: 11.2, 11.10_

- [ ] 9. Main process — RoomManager
  - [~] 9.1 Implement `RoomManager`
    - Write `src/main/RoomManager.ts`
    - Generate `roomCode` via `generateRoomCode()`
    - Compose `WebSocketServer` + `DiscoveryAgent`; start/stop both as a unit
    - Maintain `participants: Map<socketId, Participant>`; broadcast `PARTICIPANT_LIST` on join/leave
    - Handle `HELLO` → validate name → send `WELCOME` with `assignedId` and current participant list → broadcast `PARTICIPANT_JOINED`
    - Handle `TYPING` → forward to all connected sockets except the sender's `socketId`
    - Handle `SESSION_ENDED` flow: broadcast, wait ≤ 3 s, stop server
    - Delegate deletion auth to `authorizeDelete()` before broadcasting `MESSAGE_DELETED`
    - _Requirements: 2.1, 2.3, 2.4, 2.5, 2.6, 6.5, 6.6, 6.7, 6.8, 7.1, 7.2, 7.3, 7.4, 9.2, 12.7_

  - [ ]* 9.2 Write integration tests for RoomManager message flows
    - Test round-trip: two mock WS clients connect, send `CHAT_TEXT`, verify both receive broadcast
    - Test `PARTICIPANT_LIST` sent immediately on new client `HELLO`
    - Test `MESSAGE_DELETED` authorization: client A cannot delete client B's message
    - _Requirements: 7.3, 7.4, 12.7_

- [ ] 10. Main process — IpcBridge
  - [~] 10.1 Implement `IpcBridge` — session and chat channels
    - Write `src/main/IpcBridge.ts`
    - Register `ipcMain.handle` for: `room:create`, `room:join`, `room:leave`, `chat:send`, `chat:sendImage`, `chat:delete`, `chat:typing`
    - Wire handlers to `RoomManager` (host path) and `WebSocketClient` + `ReconnectionManager` (client path)
    - Push IPC events to renderer: `chat:message-received`, `chat:message-deleted`, `room:participant-list`, `room:typing`, `connection:status`, `room:session-ended`
    - _Requirements: 2.1, 2.4, 3.4, 3.5, 6.1, 8.1, 8.7, 8.8, 9.1, 15.1_

  - [~] 10.2 Implement `IpcBridge` — file transfer channels
    - Register `ipcMain.handle` for: `file:pick`, `file:download`, `file:open`
    - `file:pick` opens native dialog, validates size via `validateFileSize()`, then calls `FileTransferEngine.send()`
    - `file:download` copies temp file to user-chosen destination via native save dialog
    - `file:open` calls `shell.openPath()` on the completed temp file
    - Push IPC events to renderer: `file:progress`
    - Temp file cleanup registered on `app.on('before-quit')` via `fs.rmSync('%TEMP%/lan-clip-chat', { recursive: true, force: true })`
    - _Requirements: 11.1, 11.4, 11.5, 11.6, 11.7, 18.4_

- [ ] 11. Preload script
  - [~] 11.1 Implement preload `contextBridge` exposure
    - Write `src/preload/index.ts`
    - Expose `window.electronAPI` matching the `ElectronAPI` interface from the design
    - All `on*` methods register `ipcRenderer.on` listeners and return cleanup functions
    - Set `contextIsolation: true`, `nodeIntegration: false` in `BrowserWindow` config in `src/main/index.ts`
    - _Requirements: 14.1_

- [ ] 12. Renderer — StartupScreen
  - [~] 12.1 Implement `StartupScreen` React component
    - Write `src/renderer/screens/StartupScreen.tsx`
    - Name input with max 50-char client-side validation via `validateName()`; show inline error on invalid submit
    - "Create Room" → `electronAPI.createRoom(name)` → on success navigate to `MainWindow`; on error show inline message and stay
    - "Join Room" → show `JoinRoomDialog`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.4, 2.6_

  - [~] 12.2 Implement `JoinRoomDialog` modal component
    - Write `src/renderer/components/JoinRoomDialog.tsx`
    - 6-digit numeric input with client-side format validation via `validateRoomCode()`; show inline error on invalid format
    - On valid submit → `electronAPI.joinRoom(name, roomCode)` → navigate to `MainWindow` on success; show error on failure
    - Show "Host not found" on timeout error, specific message for other failures
    - _Requirements: 3.1, 3.2, 3.3, 3.5, 3.6, 3.7_

- [ ] 13. Renderer — UIStore and event wiring
  - [~] 13.1 Implement `UIStore` and IPC event subscriptions
    - Write `src/renderer/store/UIStore.tsx` using React context (or Zustand)
    - State: `participants`, `messages`, `connectionStatus`, `typingUsers`, `fileTransfers`
    - Subscribe to all `electronAPI.on*` events in a top-level provider; return cleanup on unmount
    - Expose actions: `addMessage`, `deleteMessage`, `setParticipants`, `setConnectionStatus`, `updateFileTransfer`, `setTypingUser`
    - _Requirements: 5.1, 7.1, 7.2, 8.5, 8.6, 11.6, 11.7_

- [ ] 14. Renderer — MainWindow layout
  - [~] 14.1 Implement `MainWindow` root layout component
    - Write `src/renderer/screens/MainWindow.tsx`
    - Render `Header` (room code, Leave button, Connection Help button), `UserPanel`, `ChatArea`, `TypingIndicator`, `MessageInput`, `ConnectionStatusIndicator`
    - Leave button: show confirmation dialog ("Leave Room?" / "End Session?") based on `isHost`; call `electronAPI.leaveRoom()` on confirm
    - "Connection Help" button: always visible; opens `FirewallHelpDialog`
    - Disable Leave button when no active session
    - _Requirements: 4.1, 4.2, 4.3, 4.5, 4.6, 4.7, 6.1, 6.2, 6.3, 6.4, 6.5, 6.8, 6.9, 16.1_

  - [~] 14.2 Implement `FirewallHelpDialog` component
    - Write `src/renderer/components/FirewallHelpDialog.tsx`
    - Display the 5-step firewall instructions from Requirement 16.2
    - Include a dismiss/close action
    - Do NOT add any code that modifies firewall rules, bypasses Defender, or makes network calls
    - _Requirements: 16.2, 16.3_

  - [~] 14.3 Implement `UserPanel` component
    - Write `src/renderer/components/UserPanel.tsx`
    - Read `participants` from `UIStore`; render each name; append "(Host)" suffix for the host
    - _Requirements: 4.2, 4.3_

  - [~] 14.4 Implement `ConnectionStatusIndicator` component
    - Write `src/renderer/components/ConnectionStatusIndicator.tsx`
    - Read `connectionStatus` from `UIStore`; render "● Connected", "● Reconnecting...", or "● Disconnected"
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

- [ ] 15. Renderer — ChatArea and MessageList
  - [~] 15.1 Implement `ChatArea` with auto-scroll logic
    - Write `src/renderer/components/ChatArea.tsx`
    - Render `MessageList` inside a scrollable container
    - Auto-scroll to bottom on new message unless `userScrolledUp` flag is set; detect manual scroll-up to set flag
    - _Requirements: 4.4_

  - [~] 15.2 Implement `MessageList` and `MessageItem` with context menu
    - Write `src/renderer/components/MessageList.tsx` and `MessageItem.tsx`
    - Render sender name above message content; display messages in chronological order
    - Right-click opens `ContextMenu` with "Copy Message" and "Delete Message" (disabled if not sender)
    - "Copy Message" → `navigator.clipboard.writeText(content)`
    - "Delete Message" → confirmation dialog "Delete message?" → on confirm call `electronAPI.deleteMessage(id)`
    - Soft-deleted messages: render placeholder (e.g., "This message was deleted") or remove from list
    - File transfer messages: render `FileTransferCard` with filename, size, progress bar, "Download" and "Open" buttons
    - _Requirements: 8.4, 8.5, 8.6, 11.6, 11.7, 11.8, 12.1, 12.2, 12.3, 12.4, 12.5, 12.6_

- [ ] 16. Renderer — TypingIndicator
  - [~] 16.1 Implement `TypingIndicator` component
    - Write `src/renderer/components/TypingIndicator.tsx`
    - Read `typingUsers` from `UIStore`; display "[Name] is typing..." for the user with the latest timestamp
    - Register a `useEffect` cleanup timer (3 s) to clear a user's typing state when no new event arrives — do not reference the 3-second window as a render constraint
    - Never display indicator for the local user's own typing
    - _Requirements: 9.3, 9.4, 9.5, 9.6, 9.7_

- [ ] 17. Renderer — MessageInput with clipboard and typing support
  - [~] 17.1 Implement `MessageInput` component with send, typing throttle, and clipboard
    - Write `src/renderer/components/MessageInput.tsx`
    - Textarea with max 500-char limit (prevent entry beyond limit); Send and Send File buttons
    - On Enter or Send click: call `electronAPI.sendMessage(text)`; clear input on success; show inline error on failure without clearing
    - On Send File click: call `electronAPI.pickAndSendFile()`
    - On `input` change: throttle `electronAPI.sendTyping()` to at most one call per 2 seconds
    - On clear/send: cancel pending typing throttle timer
    - Handle `onPaste` / `keydown Ctrl+V`: if clipboard has image only → call `electronAPI.sendImage(base64)` immediately; if text (even with image) → default paste behaviour; otherwise → no-op
    - Implement `resolveClipboardAction({ hasText, hasImage })` helper for routing logic
    - _Requirements: 8.1, 8.2, 8.3, 8.7, 8.8, 9.1, 10.1, 10.2, 10.3, 10.4, 10.5_

  - [ ]* 17.2 Write property test — P10: Typing event throttle
    - **Property 10: Typing event throttle** — For any sequence of keystroke timestamps, at most 1 `TYPING` message is emitted within any 2-second window
    - **Validates: Requirements 9.1**
    - Use `fc.array(fc.integer({min: 0, max: 5000}))` (keystroke timestamps); min 100 runs
    - Annotate: `// Feature: lan-clip-chat, Property 10: Typing event throttle`

  - [ ]* 17.3 Write property test — P11: Clipboard routing priority
    - **Property 11: Clipboard routing — text presence determines action** — If clipboard has text (with or without image), text path is taken; only image-only state triggers image send
    - **Validates: Requirements 10.2, 10.3**
    - Use `fc.record({ hasText: fc.boolean(), hasImage: fc.boolean() })`; min 100 runs
    - Annotate: `// Feature: lan-clip-chat, Property 11: Clipboard routing — text presence determines action`

- [~] 18. Checkpoint — Full unit and property test suite
  - Run `npx jest --runInBand` and ensure all tests pass. Ask the user if any failures require design clarification before continuing.

- [ ] 19. Integration — Wire main process components into `src/main/index.ts`
  - [~] 19.1 Wire `RoomManager`, `WebSocketClient`, `ReconnectionManager`, `FileTransferEngine`, `MessageStore`, and `IpcBridge` in the Electron main entry point
    - Instantiate components in `app.on('ready')`
    - Pass component references into `IpcBridge`
    - Register `app.on('before-quit')` handler to invoke `FileTransferEngine.cleanup()` and delete `%TEMP%\lan-clip-chat\` recursively
    - Create `BrowserWindow` with `contextIsolation: true`, `nodeIntegration: false`, pointing to the renderer bundle and preload script
    - _Requirements: 2.1, 3.4, 6.6, 6.8, 18.3, 18.4_

- [ ] 20. Integration — Wire renderer components into the app shell
  - [~] 20.1 Wire `StartupScreen`, `MainWindow`, `UIStore` provider, and routing in `src/renderer/App.tsx`
    - Implement a simple screen-level router (no library needed): `startup | mainwindow` state
    - Wrap the app in `UIStoreProvider`; subscribe to `onSessionEnded` to navigate back to `StartupScreen` and show "Session ended by host." toast
    - _Requirements: 1.1, 2.4, 3.5, 6.7_

- [~] 21. Checkpoint — End-to-end manual smoke test build
  - Run `npm run build` and verify the app compiles without TypeScript errors. Ask the user if questions arise before proceeding to packaging.

- [ ] 22. Packaging — electron-builder portable `.exe`
  - [~] 22.1 Verify `electron-builder.yml` and produce the portable executable
    - Run `npm run package` (which invokes `electron-builder --win portable`)
    - Confirm `dist/LanClipChat.exe` is produced
    - Verify the `.exe` launches on Windows 10/11 without UAC prompt and shows the `StartupScreen`
    - Confirm no files are written outside `%TEMP%` during runtime
    - _Requirements: 18.1, 18.2, 18.3, 18.4_

---

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- Property tests use **fast-check** (minimum 100 iterations each) and are co-located with the pure utility functions they test
- All 11 correctness properties from the design are covered: P1–P11
- The `computeBackoffDelay`, `validateName`, `validateRoomCode`, `validateMessageContent`, `authorizeDelete`, `validateFileSize`, and `parseWsMessage` functions must be **pure** to be property-testable
- The `resolveClipboardAction` helper in `MessageInput` should also be extracted as a pure function for P11
- The `splitChunks` and `assembleChunks` helpers in `FileTransferEngine` must be exported as pure functions for P9
- Checkpoints at tasks 3, 18, and 21 are **hard gates** — do not proceed past them until all required tests pass and the user has confirmed no design clarifications are needed
- Req 16.4 ("SHALL NOT bypass firewall") is satisfied by omission — no code is needed; `FirewallHelpDialog` must simply not contain any programmatic firewall modification
- File transfer temp paths use `path.join(os.tmpdir(), 'lan-clip-chat', transferId, filename)`
- The `ws` module is listed in `asarUnpack` because it contains native add-ons

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["2.1"] },
    { "id": 2, "tasks": ["2.2"] },
    { "id": 3, "tasks": ["2.3", "2.4", "2.5", "2.6", "2.7", "2.8", "2.9", "4.1"] },
    { "id": 4, "tasks": ["5.1", "6.1", "7.1"] },
    { "id": 5, "tasks": ["5.2", "7.2", "8.1"] },
    { "id": 6, "tasks": ["7.3", "8.2"] },
    { "id": 7, "tasks": ["8.3", "8.4", "8.5", "9.1"] },
    { "id": 8, "tasks": ["9.2", "10.1"] },
    { "id": 9, "tasks": ["10.2", "11.1"] },
    { "id": 10, "tasks": ["12.1", "12.2", "13.1"] },
    { "id": 11, "tasks": ["14.1", "14.2", "14.3", "14.4"] },
    { "id": 12, "tasks": ["15.1", "16.1"] },
    { "id": 13, "tasks": ["15.2"] },
    { "id": 14, "tasks": ["17.1"] },
    { "id": 15, "tasks": ["17.2", "17.3"] },
    { "id": 16, "tasks": ["19.1"] },
    { "id": 17, "tasks": ["20.1"] },
    { "id": 18, "tasks": ["22.1"] }
  ]
}
```
