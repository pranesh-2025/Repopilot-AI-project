import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard,
  GitBranch,
  Network,
  Bot,
  Zap,
  Shield,
  Heart,
  Settings,
} from 'lucide-react'

interface NavItem {
  label: string
  to: string
  icon: React.ReactNode
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard',       to: '/',             icon: <LayoutDashboard size={18} /> },
  { label: 'Repository',      to: '/repository',   icon: <GitBranch size={18} />       },
  { label: 'Architecture',    to: '/architecture', icon: <Network size={18} />          },
  { label: 'AI Copilot',      to: '/ai-copilot',   icon: <Bot size={18} />              },
  { label: 'Impact Analysis', to: '/impact',       icon: <Zap size={18} />              },
  { label: 'Security',        to: '/security',     icon: <Shield size={18} />           },
  { label: 'Code Health',     to: '/code-health',  icon: <Heart size={18} />            },
  { label: 'Settings',        to: '/settings',     icon: <Settings size={18} />         },
]

export default function Sidebar() {
  return (
    <>
      {/* Inject responsive CSS once */}
      <style>{`
        .rp-sidebar { width: 220px; min-width: 220px; }
        .rp-nav-label { display: inline; }
        @media (max-width: 900px) {
          .rp-sidebar { width: 56px; min-width: 56px; }
          .rp-nav-label { display: none; }
          .rp-brand-name { display: none; }
        }
      `}</style>

      <nav
        className="rp-sidebar"
        aria-label="Main navigation"
        style={{
          height: '100vh',
          background: 'var(--surface)',
          borderRight: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
          flexShrink: 0,
          position: 'sticky',
          top: 0,
          overflowY: 'auto',
          overflowX: 'hidden',
        }}
      >
        {/* Branding */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '20px 16px 16px',
            borderBottom: '1px solid var(--border)',
            flexShrink: 0,
          }}
        >
          {/* Logo mark */}
          <div
            aria-hidden="true"
            style={{
              width: 28,
              height: 28,
              borderRadius: 6,
              background: 'var(--accent)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <svg
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="#fff"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M12 2v3M12 19v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M2 12h3M19 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12" />
            </svg>
          </div>
          <div className="rp-brand-name">
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', lineHeight: 1.2 }}>
              RepoPilot
            </div>
            <div style={{ fontSize: 10, color: 'var(--muted)', letterSpacing: '0.04em' }}>
              AI Codebase Intelligence
            </div>
          </div>
        </div>

        {/* Nav links */}
        <ul
          role="list"
          style={{
            flex: 1,
            padding: '12px 8px',
            margin: 0,
            listStyle: 'none',
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
          }}
        >
          {NAV_ITEMS.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.to === '/'}
                aria-label={item.label}
                style={({ isActive }) => ({
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '9px 10px',
                  borderRadius: 'var(--radius)',
                  color: isActive ? 'var(--accent-light)' : 'var(--muted)',
                  background: isActive ? 'rgba(99,102,241,0.12)' : 'transparent',
                  fontWeight: isActive ? 600 : 400,
                  fontSize: 13,
                  textDecoration: 'none',
                  whiteSpace: 'nowrap',
                  transition: 'background 0.1s, color 0.1s',
                  outline: 'none',
                })}
                onFocus={(e) => {
                  e.currentTarget.style.boxShadow = '0 0 0 2px var(--accent)'
                }}
                onBlur={(e) => {
                  e.currentTarget.style.boxShadow = 'none'
                }}
              >
                <span style={{ flexShrink: 0 }} aria-hidden="true">
                  {item.icon}
                </span>
                <span className="rp-nav-label">{item.label}</span>
              </NavLink>
            </li>
          ))}
        </ul>

        {/* Footer version note */}
        <div
          className="rp-brand-name"
          style={{
            padding: '12px 16px',
            borderTop: '1px solid var(--border)',
            fontSize: 11,
            color: 'var(--muted)',
            flexShrink: 0,
          }}
        >
          v0.1.0 — alpha
        </div>
      </nav>
    </>
  )
}
