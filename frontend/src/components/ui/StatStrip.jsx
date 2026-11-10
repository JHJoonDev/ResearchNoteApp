import './ui.css';

export default function StatStrip({ items, className = '' }) {
  return <div className={`ui-stat-strip ${className}`}>
    {items.map(({ label, value, hint, tone }) => <div className={`ui-stat ${tone ? `ui-tone-${tone}` : ''}`} key={label}>
      <span className="ui-stat-label">{label}</span><strong className="ui-stat-value">{value}</strong>{hint && <small>{hint}</small>}
    </div>)}
  </div>;
}
