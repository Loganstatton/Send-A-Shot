'use client';

import { useRef, useState } from 'react';
import { fileUrl, uploadImage } from '@/lib/client/api';
import type { StoredImage } from '@/lib/types';
import { Button, cx, Spinner, toast } from './ui';

/** Upload slot: tap to pick from Photos / camera / Files; shows a thumbnail when set. */
export function ImagePicker({
  label,
  value,
  onChange,
  purpose = 'up',
  disabled,
  hint,
  aspect = 'aspect-[3/4]',
}: {
  label: string;
  value: StoredImage | null;
  onChange: (img: StoredImage | null) => void;
  purpose?: 'ref' | 'up';
  disabled?: boolean;
  hint?: string;
  aspect?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function onFile(f: File | undefined) {
    if (!f) return;
    setBusy(true);
    try {
      onChange(await uploadImage(f, purpose, label));
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  return (
    <div className={cx(disabled && 'opacity-40')}>
      <p className="mb-1 text-sm text-ink-200">{label}</p>
      <button
        type="button"
        disabled={disabled || busy}
        onClick={() => input.current?.click()}
        className={cx('relative flex w-full items-center justify-center overflow-hidden rounded-xl bg-ink-800 ring-1 ring-ink-700', aspect)}
      >
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={fileUrl(value.file)} alt={label} className="h-full w-full object-cover" />
        ) : (
          <span className="px-2 text-center text-xs text-ink-400">{busy ? <Spinner /> : '+ Tap to add'}</span>
        )}
        {busy && value && (
          <span className="absolute inset-0 flex items-center justify-center bg-black/50">
            <Spinner />
          </span>
        )}
      </button>
      {hint && <p className="mt-1 text-[11px] text-ink-400">{hint}</p>}
      {value && !disabled && (
        <Button variant="ghost" className="mt-1 h-9 min-h-0 w-full text-xs" onClick={() => onChange(null)}>
          Remove
        </Button>
      )}
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/*" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
    </div>
  );
}
