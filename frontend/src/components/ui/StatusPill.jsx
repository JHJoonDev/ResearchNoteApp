import './ui.css';

export default function StatusPill({ tone = 'neutral', children, className = '', ...props }) {
  return <span className={`ui-status-pill ui-tone-${tone} ${className}`} {...props}><span className="ui-status-dot" aria-hidden="true" />{children}</span>;
}
