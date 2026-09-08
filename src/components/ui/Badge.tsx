import type { RecentAnalysis } from '../../types/dashboard'

type StatusVariant = RecentAnalysis['status']

const STATUS_STYLES: Record<StatusVariant, { bg: string; color: string; label: string }> = {
  complete: { bg: 'rgba(34,197,94,0.12)',  color: 'var(--success)', label: 'Complete' },
  pending:  { bg: 'rgba(245,158,11,0.12)', color: 'var(--warning)', label: 'Pending'  },
  error:    { bg: 'rgba(239,68,68,0.12)',  color: 'var(--danger)',  label: 'Error'    },
}

interface BadgeProps {
  status: StatusVariant
}

export default function Badge({ status }: BadgeProps) {
  const s = STATUS_STYLES[status]
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: '2px 10px',
        borderRadius: 99,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: '0.04em',
        background: s.bg,
        color: s.color,
        textTransform: 'capitalize',
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: s.color,
          flexShrink: 0,
        }}
        aria-hidden="true"
      />
      {s.label}
    </span>
  )
}
