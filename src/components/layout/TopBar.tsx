import { useLocation } from 'react-router-dom'

const ROUTE_TITLES: Record<string, string> = {
  '/':            'Dashboard',
  '/repository':  'Repository',
  '/architecture':'Architecture',
  '/ai-copilot':  'AI Copilot',
  '/impact':      'Impact Analysis',
  '/security':    'Security',
  '/code-health': 'Code Health',
  '/settings':    'Settings',
}

export default function TopBar() {
  const { pathname } = useLocation()
  const title = ROUTE_TITLES[pathname] ?? 'RepoPilot'

  return (
    <header
      style={{
        height: 52,
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        padding: '0 24px',
        background: 'var(--surface)',
        flexShrink: 0,
      }}
    >
      <h1
        style={{
          fontSize: 15,
          fontWeight: 600,
          color: 'var(--text)',
          margin: 0,
        }}
      >
        {title}
      </h1>
    </header>
  )
}
