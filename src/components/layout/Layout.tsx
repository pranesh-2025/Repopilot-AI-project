import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import TopBar from './TopBar'

export default function Layout() {
  return (
    <div
      style={{
        display: 'flex',
        height: '100vh',
        overflow: 'hidden',
        background: 'var(--bg)',
      }}
    >
      <Sidebar />

      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          minWidth: 0,
        }}
      >
        <TopBar />

        <main
          id="main-content"
          tabIndex={-1}
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '24px',
          }}
        >
          <Outlet />
        </main>
      </div>
    </div>
  )
}
