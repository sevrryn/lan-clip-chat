/**
 * Unit tests for MessageStore.
 * Requirements: 8.4, 8.5, 8.6, 12.6
 */

import { MessageStore } from '../MessageStore'
import type { Message } from '@shared/types'

// Helper: build a minimal valid Message
function makeMessage(id: string, senderId = 'sender-1', content = 'hello'): Message {
  return {
    id,
    type: 'text',
    senderId,
    senderName: 'Alice',
    content,
    receivedAt: Date.now(),
    deleted: false
  }
}

describe('MessageStore', () => {
  let store: MessageStore

  beforeEach(() => {
    store = new MessageStore()
  })

  // ── add / getAll ──────────────────────────────────────────────────────────

  it('starts empty', () => {
    expect(store.getAll()).toEqual([])
  })

  it('add() appends a message and getAll() returns it', () => {
    const msg = makeMessage('msg-1')
    store.add(msg)
    expect(store.getAll()).toEqual([msg])
  })

  it('getAll() preserves insertion order (Req 8.4)', () => {
    const a = makeMessage('a')
    const b = makeMessage('b')
    const c = makeMessage('c')
    store.add(a)
    store.add(b)
    store.add(c)
    const ids = store.getAll().map((m) => m.id)
    expect(ids).toEqual(['a', 'b', 'c'])
  })

  it('getAll() returns a snapshot array (not the internal map)', () => {
    store.add(makeMessage('x'))
    const snapshot = store.getAll()
    // Mutating the snapshot must not affect the store
    snapshot.pop()
    expect(store.getAll()).toHaveLength(1)
  })

  // ── delete ────────────────────────────────────────────────────────────────

  it('delete() returns true when the message exists and removes it (Req 8.5, 8.6)', () => {
    store.add(makeMessage('del-me'))
    expect(store.delete('del-me')).toBe(true)
    expect(store.getAll()).toEqual([])
  })

  it('delete() returns false when the message does not exist', () => {
    expect(store.delete('nonexistent')).toBe(false)
  })

  it('delete() only removes the targeted message, leaving others intact', () => {
    const a = makeMessage('a')
    const b = makeMessage('b')
    const c = makeMessage('c')
    store.add(a)
    store.add(b)
    store.add(c)
    store.delete('b')
    const ids = store.getAll().map((m) => m.id)
    expect(ids).toEqual(['a', 'c'])
  })

  it('delete() called twice for the same id returns false on second call', () => {
    store.add(makeMessage('once'))
    expect(store.delete('once')).toBe(true)
    expect(store.delete('once')).toBe(false)
  })

  // ── clear ─────────────────────────────────────────────────────────────────

  it('clear() empties the store (Req 12.6)', () => {
    store.add(makeMessage('1'))
    store.add(makeMessage('2'))
    store.add(makeMessage('3'))
    store.clear()
    expect(store.getAll()).toEqual([])
  })

  it('clear() on an already-empty store is a no-op', () => {
    expect(() => store.clear()).not.toThrow()
    expect(store.getAll()).toEqual([])
  })

  it('store is usable after clear()', () => {
    store.add(makeMessage('old'))
    store.clear()
    const fresh = makeMessage('new')
    store.add(fresh)
    expect(store.getAll()).toEqual([fresh])
  })
})
