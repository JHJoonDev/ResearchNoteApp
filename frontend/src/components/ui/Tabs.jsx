import { useId, useRef } from 'react';
import './ui.css';

export default function Tabs({ items, value, onChange, ariaLabel, className = '' }) {
  const id = useId();
  const buttons = useRef([]);
  const onKeyDown = (event, index) => {
    let next;
    if (event.key === 'ArrowRight') next = (index + 1) % items.length;
    if (event.key === 'ArrowLeft') next = (index - 1 + items.length) % items.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = items.length - 1;
    if (next === undefined) return;
    event.preventDefault();
    buttons.current[next]?.focus();
    onChange(items[next].id);
  };
  return <div className={`ui-tabs ${className}`} role="tablist" aria-label={ariaLabel}>
    {items.map((item, index) => <button key={item.id} id={`${id}-${item.id}`} ref={(node) => { buttons.current[index] = node; }} type="button" role="tab"
      aria-selected={value === item.id} tabIndex={value === item.id ? 0 : -1}
      className={value === item.id ? 'ui-tab ui-tab-active' : 'ui-tab'} onClick={() => onChange(item.id)} onKeyDown={(event) => onKeyDown(event, index)}>
      {item.label}{item.count !== undefined && <span className="ui-tab-count">{item.count}</span>}
    </button>)}
  </div>;
}
