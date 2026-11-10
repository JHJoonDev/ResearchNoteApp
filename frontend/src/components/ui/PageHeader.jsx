import { Fragment } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import './ui.css';

export default function PageHeader({ breadcrumbs = [], title, description, actions, className = '' }) {
  return <header className={`ui-page-header ${className}`}>
    {breadcrumbs.length > 0 && <nav className="ui-breadcrumbs" aria-label="현재 위치">
      {breadcrumbs.map(({ label, to }, index) => <Fragment key={`${label}-${index}`}>
        {index > 0 && <ChevronRight aria-hidden="true" />}
        {to ? <Link to={to}>{label}</Link> : <span aria-current={index === breadcrumbs.length - 1 ? 'page' : undefined}>{label}</span>}
      </Fragment>)}
    </nav>}
    <div className="ui-page-heading"><div><h1>{title}</h1>{description && <p>{description}</p>}</div>
      {actions && <div className="ui-page-actions">{actions}</div>}
    </div>
  </header>;
}
