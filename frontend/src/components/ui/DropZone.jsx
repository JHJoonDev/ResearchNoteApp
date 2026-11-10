import { useId, useState } from 'react';
import { UploadCloud } from 'lucide-react';
import './ui.css';

export default function DropZone({ onFiles, accept, hint, disabled = false, children, inputProps = {}, className = '', 'aria-label': ariaLabel = '파일 추가', ...props }) {
  const id = useId();
  const [dragging, setDragging] = useState(false);
  return <div className={`ui-drop-zone ${dragging ? 'ui-drop-zone-active' : ''} ${disabled ? 'ui-disabled' : ''} ${className}`}
    onDragOver={(event) => { event.preventDefault(); if (!disabled) setDragging(true); }} onDragLeave={() => setDragging(false)}
    onDrop={(event) => { event.preventDefault(); setDragging(false); if (!disabled && event.dataTransfer.files.length) onFiles?.(event.dataTransfer.files); }} {...props}>
    <UploadCloud aria-hidden="true" />{!children && <label htmlFor={id}>{ariaLabel}</label>}
    {hint && <p>{hint}</p>}
    {children || <input id={id} type="file" multiple accept={accept} aria-label={ariaLabel} disabled={disabled} {...inputProps}
      onChange={(event) => { inputProps.onChange?.(event); if (event.target.files.length) onFiles?.(event.target.files); }} />}
  </div>;
}
