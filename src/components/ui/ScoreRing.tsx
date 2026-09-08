/** Circular SVG score indicator. Colour reflects the score range:
 *  ≥ 80 → success (green), 60–79 → warning (amber), < 60 → danger (red)
 */

interface ScoreRingProps {
  score: number
  label: string
  size?: number
}

function scoreColor(score: number): string {
  if (score >= 80) return 'var(--success)'
  if (score >= 60) return 'var(--warning)'
  return 'var(--danger)'
}

export default function ScoreRing({ score, label, size = 100 }: ScoreRingProps) {
  const radius = (size - 12) / 2
  const circumference = 2 * Math.PI * radius
  const filled = (score / 100) * circumference
  const color = scoreColor(score)

  return (
    <figure
      role="img"
      aria-label={`${label}: ${score} out of 100`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 8,
        margin: 0,
      }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        aria-hidden="true"
      >
        {/* Track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--surface2)"
          strokeWidth={10}
        />
        {/* Progress */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={10}
          strokeDasharray={circumference}
          strokeDashoffset={circumference - filled}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
        {/* Score text */}
        <text
          x={size / 2}
          y={size / 2}
          dominantBaseline="central"
          textAnchor="middle"
          fill="var(--text)"
          fontSize={size * 0.22}
          fontWeight={700}
          fontFamily="-apple-system, 'Segoe UI', system-ui, sans-serif"
        >
          {score}
        </text>
      </svg>
      <figcaption
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: 'var(--muted)',
          textAlign: 'center',
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
        }}
      >
        {label}
      </figcaption>
    </figure>
  )
}
