import { useLocation } from 'react-router-dom'

const FEATURE_DESCRIPTIONS: Record<string, { description: string; phase: string }> = {
  '/architecture': {
    description: 'Automated architecture inference, module dependency graphs, and layer analysis.',
    phase: 'Phase 2',
  },
  '/ai-copilot': {
    description: 'RAG-powered codebase Q&A, onboarding assistant, and change summarisation.',
    phase: 'Phase 3',
  },
  '/impact': {
    description: 'Change-impact analysis — identify which modules are affected by a given file change.',
    phase: 'Phase 3',
  },
  '/security': {
    description: 'Vulnerability scanning, exposed-secret detection, and dependency CVE reporting.',
    phase: 'Phase 4',
  },
  '/code-health': {
    description: 'Code complexity metrics, technical-debt scoring, and maintainability trends.',
    phase: 'Phase 4',
  },
  '/settings': {
    description: 'Configure API keys, analysis preferences, and notification settings.',
    phase: 'Phase 2',
  },
}

const ROUTE_LABELS: Record<string, string> = {
  '/architecture':'Architecture',
  '/ai-copilot':  'AI Copilot',
  '/impact':      'Impact Analysis',
  '/security':    'Security',
  '/code-health': 'Code Health',
  '/settings':    'Settings',
}

export default function PlaceholderPage() {
  const { pathname } = useLocation()
  const label = ROUTE_LABELS[pathname] ?? 'This Feature'
  const info  = FEATURE_DESCRIPTIONS[pathname]

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '60vh',
      }}
    >
      <div
        style={{
          textAlign: 'center',
          maxWidth: 480,
          padding: '48px 40px',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
        }}
      >
        {/* Icon */}
        <div
          aria-hidden="true"
          style={{
            width: 52,
            height: 52,
            borderRadius: 12,
            background: 'rgba(99,102,241,0.12)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 20px',
          }}
        >
          <svg
            viewBox="0 0 24 24"
            width="24"
            height="24"
            fill="none"
            stroke="var(--accent-light)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 2L2 7l10 5 10-5-10-5z" />
            <path d="M2 17l10 5 10-5" />
            <path d="M2 12l10 5 10-5" />
          </svg>
        </div>

        <h2
          style={{
            fontSize: 18,
            fontWeight: 700,
            color: 'var(--text)',
            margin: '0 0 8px',
          }}
        >
          {label}
        </h2>

        <p
          style={{
            fontSize: 13,
            color: 'var(--muted)',
            lineHeight: 1.7,
            margin: '0 0 20px',
          }}
        >
          {info?.description ?? 'This feature is being built.'}
        </p>

        <span
          style={{
            display: 'inline-block',
            padding: '4px 14px',
            background: 'rgba(99,102,241,0.12)',
            color: 'var(--accent-light)',
            borderRadius: 99,
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: '0.04em',
          }}
        >
          Coming in {info?.phase ?? 'a future phase'}
        </span>
      </div>
    </div>
  )
}
