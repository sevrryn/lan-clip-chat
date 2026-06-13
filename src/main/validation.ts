/**
 * Pure validation and utility functions for LAN Clip Chat.
 * All functions are side-effect free and never throw.
 *
 * Requirements: 1.3, 1.4, 2.3, 3.2, 3.3, 8.2, 8.3, 8.9,
 *               12.7, 14.1–14.6, 15.2, 15.4
 */

import type { WsMessage } from '../shared/wsMessages'

// ── 1 MiB size limit for incoming WS frames ───────────────────────────────────
const MAX_WS_MESSAGE_BYTES = 1_048_576 // 1 MiB

// ── 900 MB file size limit ────────────────────────────────────────────────────
const MAX_FILE_BYTES = 943_718_400 // 900 MB in bytes

// ── Result types ──────────────────────────────────────────────────────────────

export type NameValidationResult =
  | { valid: true }
  | { valid: false; reason: string }

export type RoomCodeValidationResult =
  | { valid: true }
  | { valid: false }

export type ParseWsMessageResult =
  | { valid: true; message: WsMessage }
  | { valid: false }

export type MessageContentValidationResult =
  | { valid: true }
  | { valid: false }

// ── validateName ──────────────────────────────────────────────────────────────

/**
 * Validates a display name.
 * Returns `{ valid: true }` if the trimmed value has length 1–50.
 * Returns `{ valid: false, reason }` otherwise.
 *
 * Handles null/undefined gracefully by treating them as empty strings.
 */
export function validateName(s: string): NameValidationResult {
  // Guard against null/undefined without throwing
  const raw = s == null ? '' : String(s)
  const trimmed = raw.trim()

  if (trimmed.length === 0) {
    return { valid: false, reason: 'Name must not be empty or contain only whitespace.' }
  }

  if (trimmed.length > 50) {
    return { valid: false, reason: 'Name must be 50 characters or fewer after trimming.' }
  }

  return { valid: true }
}

// ── validateRoomCode ──────────────────────────────────────────────────────────

/**
 * Validates a room code string.
 * Returns `{ valid: true }` if the value matches `/^\d{6}$/`.
 * Returns `{ valid: false }` otherwise.
 *
 * Handles null/undefined gracefully.
 */
export function validateRoomCode(s: string): RoomCodeValidationResult {
  if (s == null) return { valid: false }
  return /^\d{6}$/.test(String(s)) ? { valid: true } : { valid: false }
}

// ── generateRoomCode ──────────────────────────────────────────────────────────

/**
 * Generates a uniformly random 6-digit room code string, zero-padded to 6 digits.
 * Output is always in the range "000000"–"999999".
 */
export function generateRoomCode(): string {
  const n = Math.floor(Math.random() * 1_000_000) // 0–999999 inclusive
  return String(n).padStart(6, '0')
}

// ── parseWsMessage ────────────────────────────────────────────────────────────

/**
 * Parses and validates an incoming WebSocket frame.
 *
 * Rules applied (in order):
 *  1. Size > 1 MiB → `{ valid: false }`
 *  2. Not valid JSON → `{ valid: false }`
 *  3. Missing `type` field or `type` not a string → `{ valid: false }`
 *
 * NEVER throws regardless of input shape.
 */
export function parseWsMessage(raw: Buffer | string): ParseWsMessageResult {
  try {
    // ── 1. Size gate ──────────────────────────────────────────────────────────
    let byteLength: number

    if (Buffer.isBuffer(raw)) {
      byteLength = raw.length
    } else {
      // String: measure in bytes (UTF-8) without allocating a Buffer
      byteLength = Buffer.byteLength(raw as string, 'utf8')
    }

    if (byteLength > MAX_WS_MESSAGE_BYTES) {
      return { valid: false }
    }

    // ── 2. JSON parse ─────────────────────────────────────────────────────────
    const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : (raw as string)
    let parsed: unknown

    try {
      parsed = JSON.parse(text)
    } catch {
      return { valid: false }
    }

    // ── 3. Structural check: must be a plain object with a string `type` ──────
    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed) ||
      typeof (parsed as Record<string, unknown>)['type'] !== 'string'
    ) {
      return { valid: false }
    }

    return { valid: true, message: parsed as WsMessage }
  } catch {
    // Catch-all: never let unexpected errors surface
    return { valid: false }
  }
}

// ── validateMessageContent ────────────────────────────────────────────────────

/**
 * Validates text message content.
 * Returns `{ valid: true }` if the string is non-empty after trimming AND length ≤ 500.
 * Returns `{ valid: false }` otherwise.
 *
 * Handles null/undefined gracefully.
 */
export function validateMessageContent(s: string): MessageContentValidationResult {
  if (s == null) return { valid: false }
  const raw = String(s)
  if (raw.trim().length === 0) return { valid: false }
  if (raw.length > 500) return { valid: false }
  return { valid: true }
}

// ── authorizeDelete ───────────────────────────────────────────────────────────

/**
 * Returns `true` iff `requesterId === ownerId`.
 * A participant may only delete their own messages.
 */
export function authorizeDelete(requesterId: string, ownerId: string): boolean {
  return requesterId === ownerId
}

// ── validateFileSize ──────────────────────────────────────────────────────────

/**
 * Returns `false` if `bytes` exceeds 900 MB (943_718_400 bytes); otherwise `true`.
 * Accepts both `bigint` and `number` to accommodate the `totalBytes` field in
 * `FileTransferRecord` (number) and potential OS-level `fs.stat` bigint sizes.
 */
export function validateFileSize(bytes: bigint | number): boolean {
  if (typeof bytes === 'bigint') {
    return bytes <= BigInt(MAX_FILE_BYTES)
  }
  return bytes <= MAX_FILE_BYTES
}

// ── computeBackoffDelay ───────────────────────────────────────────────────────

/**
 * Returns the reconnection back-off delay (in milliseconds) for attempt index `n`.
 *
 * Formula: `Math.min(1000 * 2^n, 30000)`
 *
 * | Attempt | Delay  |
 * |---------|--------|
 * | 0       |  1 000 |
 * | 1       |  2 000 |
 * | 2       |  4 000 |
 * | 3       |  8 000 |
 * | 4       | 16 000 |
 * | 5+      | 30 000 |
 */
export function computeBackoffDelay(attempt: number): number {
  return Math.min(1000 * Math.pow(2, attempt), 30_000)
}
