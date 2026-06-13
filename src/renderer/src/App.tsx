import React from 'react'

/**
 * App root component.
 * Screen routing (StartupScreen ↔ MainWindow) will be wired in task 20.1.
 * This stub renders a placeholder so the renderer bundle compiles cleanly.
 */
function App(): React.JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        fontFamily: 'system-ui, sans-serif'
      }}
    >
      <h1>LAN Clip Chat</h1>
      <p>Starting up…</p>
    </div>
  )
}

export default App
