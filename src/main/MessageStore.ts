/**
 * MessageStore — in-memory store for chat messages.
 *
 * - Keyed by message id (UUID v4)
 * - Maintains insertion order (Map preserves insertion order in JS)
 * - NOT persisted to disk
 * - Cleared on session end via `clear()`
 *
 * Requirements: 8.4, 8.5, 8.6, 12.6
 */

import type { Message } from '@shared/types'

export class MessageStore {
  /** Internal map: id → Message, preserving insertion order. */
  private readonly messages: Map<string, Message> = new Map()

  /**
   * Append a message to the store.
   * If a message with the same id already exists it is silently overwritten,
   * but that should not happen in normal usage (ids are UUID v4).
   */
  add(msg: Message): void {
    this.messages.set(msg.id, msg)
  }

  /**
   * Remove a message by id.
   * @returns `true` if the message existed and was removed, `false` otherwise.
   */
  delete(id: string): boolean {
    return this.messages.delete(id)
  }

  /**
   * Return all messages in chronological (insertion) order.
   */
  getAll(): Message[] {
    return Array.from(this.messages.values())
  }

  /**
   * Remove all messages from the store.
   * Called when the session ends (Requirement 12.6).
   */
  clear(): void {
    this.messages.clear()
  }
}
