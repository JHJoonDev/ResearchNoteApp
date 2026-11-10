import { FolderOpen } from 'lucide-react';
import './ui.css';

export default function EmptyState({ icon, title, description, action, className = '' }) {
  return <div className={`ui-empty-state ${className}`}><div className="ui-empty-icon" aria-hidden="true">{icon || <FolderOpen />}</div>
    <h3>{title}</h3>{description && <p>{description}</p>}{action && <div className="ui-empty-action">{action}</div>}
  </div>;
}
