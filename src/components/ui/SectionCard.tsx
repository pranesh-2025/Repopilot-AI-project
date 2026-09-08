import type { ReactNode } from 'react'

interface SectionCardProps {
  title?: string
  action?: ReactNode
  children: ReactNode
  style?: React.CSSProperties
}

export default function SectionCard({ title, action, children, style }: SectionCardProps) {
  return (
    <section
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        padding: '20px 24px',
        ...style,
      }}
    >
      {(title || action) && (
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 16,
          }}
        >
          {title && (
            <h2
              style={{
                fontSize: 13,
                fontWeight: 600,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color: 'var(--muted)',
                margin: 0,
              }}
            >
              {title}
            </h2>
          )}
          {action && <div>{action}</div>}
        </header>
      )}
      {children}
    </section>
  )
}
