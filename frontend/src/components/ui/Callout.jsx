import { useState } from 'react';
import { Info, ChevronDown, CheckCircle2, AlertTriangle } from 'lucide-react';
import './ui.css';

export default function Callout({ tone = 'info', icon, title, titleAs = 'h3', children, actions, collapsible = false, className = '', ...props }) {
  const [open, setOpen] = useState(!collapsible);
  const Title = titleAs;
  const defaultIcon = tone === 'success' ? <CheckCircle2 /> : tone === 'warning' || tone === 'danger' ? <AlertTriangle /> : <Info />;
  return <section className={`ui-callout ui-tone-${tone} ${className}`} {...props}>
    <div className="ui-callout-heading"><span className="ui-callout-icon" aria-hidden="true">{icon || defaultIcon}</span>
      <Title className="ui-callout-title">{collapsible ? <button type="button" className="ui-callout-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>{title}<ChevronDown className={open ? 'ui-chevron-open' : ''} aria-hidden="true" /></button> : title}</Title>
    </div>
    {open && (children || actions) && <div className="ui-callout-content">{children}{actions && <div className="ui-callout-actions">{actions}</div>}</div>}
  </section>;
}
