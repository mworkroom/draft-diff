import { useId, useState } from 'react';
import type { Side } from '../lib/compare';

interface Props { side: Side; file: File | null; disabled: boolean; onFile: (file: File) => void }
export function FilePicker({ side, file, disabled, onFile }: Props) {
  const id = useId();
  const [dragging, setDragging] = useState(false);
  const before = side === 'before';
  return <div className={`file-picker ${side} ${dragging ? 'dragging' : ''}`}
    onDragOver={event => { event.preventDefault(); if (!disabled) setDragging(true); }}
    onDragLeave={() => setDragging(false)}
    onDrop={event => {
      event.preventDefault(); setDragging(false);
      if (!disabled && event.dataTransfer.files[0]) onFile(event.dataTransfer.files[0]);
    }}>
    <label className="file-label" htmlFor={id}><span className={`dot ${side}`} />{before ? 'Before · Original' : 'After · Revised'}</label>
    <div className="file-row">
      <div className={`file-name ${file ? '' : 'placeholder'}`} title={file?.name}>
        {file?.name ?? 'Choose a .docx file or drop it here'}
      </div>
      <label className={`button file-button ${disabled ? 'disabled' : ''}`} htmlFor={id}>Choose file</label>
      <input id={id} type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        aria-label={before ? 'Choose Before file' : 'Choose After file'} disabled={disabled}
        onChange={event => {
          const selected = event.currentTarget.files?.[0];
          if (selected) onFile(selected);
          event.currentTarget.value = '';
        }} />
    </div>
  </div>;
}
