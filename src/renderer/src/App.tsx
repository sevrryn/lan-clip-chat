import React, { useEffect, useState } from 'react'
import type { Participant } from '../shared/types'

interface RoomState {
  roomCode: string
  hostName: string
  participants: Participant[]
  status: 'open' | 'closed'
}

function App(): React.JSX.Element {
  const [roomState, setRoomState] = useState<RoomState | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // Initialize room on mount
    const initRoom = async () => {
      try {
        // Create/get room
        await window.api.createRoom()

        // Get initial state
        const state = await window.api.getRoomState()
        setRoomState(state)
        setLoading(false)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to initialize room')
        setLoading(false)
      }
    }

    initRoom()
  }, [])

  useEffect(() => {
    // Subscribe to participant joined
    const unsubJoined = window.api.onParticipantJoined((participant: Participant) => {
      setRoomState((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          participants: [...prev.participants.filter((p) => p.id !== participant.id), participant]
        }
      })
    })

    // Subscribe to participant left
    const unsubLeft = window.api.onParticipantLeft((participantId: string) => {
      setRoomState((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          participants: prev.participants.filter((p) => p.id !== participantId)
        }
      })
    })

    // Subscribe to room state changes
    const unsubStateChanged = window.api.onRoomStateChanged((state: RoomState) => {
      setRoomState(state)
    })

    return () => {
      unsubJoined()
      unsubLeft()
      unsubStateChanged()
    }
  }, [])

  if (loading) {
    return (
      <div style={{ padding: '20px', fontFamily: 'monospace' }}>
        <h1>LAN Clip Chat</h1>
        <p>Initializing room...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ padding: '20px', fontFamily: 'monospace', color: 'red' }}>
        <h1>Error</h1>
        <p>{error}</p>
      </div>
    )
  }

  if (!roomState) {
    return (
      <div style={{ padding: '20px', fontFamily: 'monospace' }}>
        <h1>Room not loaded</h1>
      </div>
    )
  }

  return (
    <div style={{ padding: '20px', fontFamily: 'monospace' }}>
      <h1>LAN Clip Chat</h1>

      <div style={{ marginBottom: '20px' }}>
        <h2>Room Status</h2>
        <p>
          <strong>Room Code:</strong> <code>{roomState.roomCode}</code>
        </p>
        <p>
          <strong>Host:</strong> {roomState.hostName}
        </p>
        <p>
          <strong>Status:</strong> {roomState.status}
        </p>
      </div>

      <div>
        <h2>Participants ({roomState.participants.length})</h2>
        <ul>
          {roomState.participants.map((p) => (
            <li key={p.id}>
              {p.name} {p.isHost ? '(host)' : ''}
            </li>
          ))}
        </ul>
      </div>

      <div style={{ marginTop: '20px', color: '#666', fontSize: '12px' }}>
        <p>Room is live and accepting connections.</p>
      </div>
    </div>
  )
}

export default App
