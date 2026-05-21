import { useRef, useState, type DragEvent, type ChangeEvent } from 'react';

interface Props {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
}

export function DropZone({ onFiles, disabled }: Props) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    if (disabled) return;
    const zips = Array.from(e.dataTransfer.files).filter((f) =>
      f.name.toLowerCase().endsWith('.zip')
    );
    if (zips.length) onFiles(zips);
  }

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    const zips = Array.from(e.target.files ?? []).filter((f) =>
      f.name.toLowerCase().endsWith('.zip')
    );
    if (zips.length) onFiles(zips);
    e.target.value = '';
  }

  return (
    <div
      onClick={() => !disabled && inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); if (!disabled) setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      className={[
        'border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-colors',
        dragging
          ? 'border-indigo-400 bg-indigo-950'
          : 'border-slate-600 hover:border-slate-400',
        disabled ? 'opacity-40 cursor-not-allowed' : '',
      ].join(' ')}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".zip"
        multiple
        className="hidden"
        onChange={handleChange}
        disabled={disabled}
      />
      <p className="text-2xl mb-2">📦</p>
      <p className="text-slate-300 font-medium">Drop Multitracks zips here</p>
      <p className="text-slate-500 text-sm mt-1">or click to browse</p>
    </div>
  );
}
