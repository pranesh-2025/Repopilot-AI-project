import type { LanguageStat } from '../../types/dashboard'

interface LanguageBarProps {
  languages: LanguageStat[]
}

export default function LanguageBar({ languages }: LanguageBarProps) {
  return (
    <div>
      {/* Segmented bar */}
      <div
        role="img"
        aria-label="Language breakdown bar"
        style={{
          display: 'flex',
          height: 8,
          borderRadius: 99,
          overflow: 'hidden',
          gap: 2,
        }}
      >
        {languages.map((lang) => (
          <div
            key={lang.language}
            style={{
              flex: lang.percentage,
              background: lang.color,
              minWidth: 2,
            }}
            title={`${lang.language}: ${lang.percentage}%`}
          />
        ))}
      </div>

      {/* Legend */}
      <ul
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '8px 20px',
          marginTop: 12,
          padding: 0,
          listStyle: 'none',
        }}
      >
        {languages.map((lang) => (
          <li
            key={lang.language}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 12,
              color: 'var(--muted)',
            }}
          >
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: 2,
                background: lang.color,
                flexShrink: 0,
              }}
              aria-hidden="true"
            />
            <span style={{ color: 'var(--text)', fontWeight: 500 }}>{lang.language}</span>
            <span>{lang.percentage}%</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
