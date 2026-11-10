import { FlaskConical } from 'lucide-react';
import './ui.css';

export default function BrandMark({ className = '' }) {
  return <div className={`ui-brand-mark ${className}`}><span><FlaskConical aria-hidden="true" /></span>LabHub</div>;
}
