import { Check } from 'lucide-react';
import './ui.css';

export default function Stepper({ steps, className = '' }) {
  return <ol className={`ui-stepper ${className}`} aria-label="진행 단계">
    {steps.map(({ label, state }, index) => <li key={`${label}-${index}`} className={`ui-step ui-step-${state}`} aria-current={state === 'current' ? 'step' : undefined}>
      <span className="ui-step-number">{state === 'done' ? <Check aria-label="완료" /> : index + 1}</span><span>{label}</span>
    </li>)}
  </ol>;
}
