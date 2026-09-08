import type { ReactNode } from 'react'

interface StatCardProps {
  icon: ReactNode
  label: string
  value: string | number
  unit?: string
}

export default function StatCard({ icon, label, value, unit }: StatCardProps) {
  return (
    <div
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        padding: '18px 20px',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: 'var(--radius)',
          background: 'var(--surface2)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--accent-light)',
          flexShrink: 0,
        }}
        aria-hidden="true"
      >
        {icon}
      </div>
      <div>
        <div
          style={{
            fontSize: 24,
            fontWeight: 700,
            color: 'var(--text)',
            lineHeight: 1.2,
          }}
        >
          {typeof value === 'number' ? value.toLocaleString() : value}
          {unit && (
            <span style={{ fontSize: 14, fontWeight: 400, color: 'var(--muted)', marginLeft: 4 }}>
              {unit}
            </span>
          )}
        </div>
        <div
          style={{
            fontSize: 12,
            color: 'var(--muted)',
            marginTop: 2,
            fontWeight: 500,
            letterSpacing: '0.03em',
          }}
        >
          {label}
        </div>
      </div>
    </div>
  )
}
