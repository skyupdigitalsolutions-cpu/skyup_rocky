// Small shared presentational helpers used across pages.

export function Chip({ children, tone = 'default' }) {
  return <span className={`chip ${tone}`}>{tone !== 'default' && <span className="tick" />}{children}</span>;
}

export function SeverityChip({ severity }) {
  const map = { critical: 'red', attention: 'amber', info: 'green' };
  const label = { critical: 'Critical', attention: 'Attention', info: 'Steady' };
  return <Chip tone={map[severity] || 'default'}>{label[severity] || severity}</Chip>;
}

export function Loader({ label = 'Loading…' }) {
  return (
    <div className="row" style={{ color: 'var(--muted)', padding: 20 }}>
      <span className="spin" /> {label}
    </div>
  );
}

export function Empty({ title, hint, action }) {
  return (
    <div className="empty">
      <div style={{ fontSize: 15, color: 'var(--text)', marginBottom: 6 }}>{title}</div>
      {hint && <div className="small">{hint}</div>}
      {action && <div className="mt">{action}</div>}
    </div>
  );
}

// The signature element: an answer's provenance, clearly separated from the
// answer text — observed sources + period on one side, missing data flagged.
export function GroundingPanel({ grounding }) {
  if (!grounding) return null;
  const { sources = [], period, missing = [] } = grounding;
  if (!sources.length && !missing.length && !period) return null;
  return (
    <div className="grounding">
      {(sources.length > 0 || period) && (
        <div>
          <div className="glabel">Observed data</div>
          <div className="row wrap" style={{ gap: 6, marginTop: 6 }}>
            {period && <Chip tone="accent">{period}</Chip>}
            {sources.map((s) => (
              <Chip key={s}>{s}</Chip>
            ))}
          </div>
        </div>
      )}
      {missing.length > 0 && (
        <div className="missing-note">
          <strong>Not available:</strong> {missing.join(' · ')}. Rocky won’t guess about these.
        </div>
      )}
    </div>
  );
}
