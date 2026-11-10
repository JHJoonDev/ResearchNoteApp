import './ui.css';

export default function Card({ title, actions, padded = true, children, className = '', ...props }) {
  return <section className={`ui-card ${padded ? 'ui-card-padded' : ''} ${className}`} {...props}>
    {(title || actions) && <div className="ui-card-header">{title && <h2>{title}</h2>}{actions && <div className="ui-card-actions">{actions}</div>}</div>}
    {children}
  </section>;
}

export function CardSection({ children, className = '', ...props }) {
  return <div className={`ui-card-section ${className}`} {...props}>{children}</div>;
}
