'use client';

import { ReactNode, useEffect, useId, useState } from 'react';

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ');
}

type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button({
  children,
  variant = 'secondary',
  className,
  loading,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; loading?: boolean }) {
  const styles: Record<BtnVariant, string> = {
    primary: 'bg-accent text-ink-950 active:bg-accent-deep font-semibold',
    secondary: 'bg-ink-700 text-ink-200 active:bg-ink-600',
    ghost: 'bg-transparent text-ink-200 active:bg-ink-800',
    danger: 'bg-red-900/60 text-red-100 active:bg-red-900',
  };
  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      className={cx(
        'inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl px-4 text-[15px] transition-colors disabled:opacity-40',
        styles[variant],
        className,
      )}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <span className={cx('inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent', className)} />;
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('rounded-2xl bg-ink-900 p-4 ring-1 ring-ink-800', className)}>{children}</div>;
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-2 mt-5 flex items-center justify-between px-1">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-400">{children}</h2>
      {right}
    </div>
  );
}

export function PageHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
  return (
    <header className="sticky top-0 z-20 -mx-4 mb-2 flex items-center justify-between bg-ink-950/90 px-4 pb-3 pt-[calc(env(safe-area-inset-top)+12px)] backdrop-blur">
      <div className="min-w-0">
        <h1 className="truncate text-xl font-semibold">{title}</h1>
        {subtitle && <p className="truncate text-xs text-ink-400">{subtitle}</p>}
      </div>
      {right}
    </header>
  );
}

export function Label({ children, htmlFor, hint }: { children: ReactNode; htmlFor?: string; hint?: ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="mb-1 block text-sm text-ink-200">
      {children}
      {hint && <span className="ml-1 text-xs text-ink-400">{hint}</span>}
    </label>
  );
}

const inputBase =
  'w-full rounded-xl bg-ink-800 px-3 py-3 text-base text-white placeholder:text-ink-400 outline-none ring-1 ring-ink-700 focus:ring-2 focus:ring-accent';

/** Text inputs use 16px font so iOS Safari doesn't zoom on focus. */
export function TextInput({ label, hint, className, ...rest }: React.InputHTMLAttributes<HTMLInputElement> & { label?: string; hint?: ReactNode }) {
  const id = useId();
  return (
    <div className={className}>
      {label && (
        <Label htmlFor={id} hint={hint}>
          {label}
        </Label>
      )}
      <input id={id} {...rest} className={inputBase} />
    </div>
  );
}

export function TextArea({
  label,
  hint,
  className,
  rows = 2,
  warning,
  ...rest
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: string; hint?: ReactNode; warning?: ReactNode }) {
  const id = useId();
  return (
    <div className={className}>
      {label && (
        <Label htmlFor={id} hint={hint}>
          {label}
        </Label>
      )}
      <textarea id={id} rows={rows} {...rest} className={cx(inputBase, 'resize-y leading-snug', warning ? 'ring-amber-500/70' : '')} />
      {warning && <p className="mt-1 text-xs text-amber-400">{warning}</p>}
    </div>
  );
}

export function Select({
  label,
  value,
  onChange,
  options,
  placeholder,
  className,
  disabled,
  hint,
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  hint?: ReactNode;
}) {
  const id = useId();
  const hasValue = options.some((o) => o.value === value);
  return (
    <div className={className}>
      {label && (
        <Label htmlFor={id} hint={hint}>
          {label}
        </Label>
      )}
      <select id={id} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className={cx(inputBase, 'appearance-none disabled:opacity-50')}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {!hasValue && value && <option value={value}>{value} (not on server)</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Slider + numeric readout; large thumb for touch. */
export function Slider({
  label,
  value,
  onChange,
  min,
  max,
  step,
  hint,
  disabled,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
  hint?: ReactNode;
  disabled?: boolean;
}) {
  const id = useId();
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return (
    <div className={cx(disabled && 'opacity-40')}>
      <div className="flex items-center justify-between">
        <Label htmlFor={id} hint={hint}>
          {label}
        </Label>
        <input
          inputMode="decimal"
          value={text}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => {
            const n = Number(text);
            if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n)));
            else setText(String(value));
          }}
          className="w-20 rounded-lg bg-ink-800 px-2 py-1 text-right text-base tabular-nums text-white ring-1 ring-ink-700"
        />
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="range mt-1 w-full"
      />
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="flex min-h-[44px] w-full items-center justify-between gap-3 text-left disabled:opacity-40"
    >
      <span className="min-w-0">
        <span className="block text-[15px]">{label}</span>
        {description && <span className="block text-xs text-ink-400">{description}</span>}
      </span>
      <span className={cx('relative h-7 w-12 shrink-0 rounded-full transition-colors', checked ? 'bg-accent' : 'bg-ink-600')}>
        <span className={cx('absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-[22px]' : 'translate-x-0.5')} />
      </span>
    </button>
  );
}

/** Collapsible section built on <details> — works without JS hover, great on touch. */
export function Collapsible({
  title,
  children,
  defaultOpen,
  badge,
}: {
  title: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  badge?: ReactNode;
}) {
  return (
    <details open={defaultOpen} className="group rounded-2xl bg-ink-900 ring-1 ring-ink-800">
      <summary className="flex min-h-[52px] cursor-pointer list-none items-center justify-between gap-2 px-4 text-[15px] font-medium">
        <span className="flex items-center gap-2">
          {title}
          {badge}
        </span>
        <span className="text-ink-400 transition-transform group-open:rotate-180">⌄</span>
      </summary>
      <div className="space-y-4 px-4 pb-4">{children}</div>
    </details>
  );
}

export function Chip({ active, children, onClick, className }: { active?: boolean; children: ReactNode; onClick?: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        'min-h-[40px] shrink-0 whitespace-nowrap rounded-full px-4 text-sm transition-colors',
        active ? 'bg-accent text-ink-950' : 'bg-ink-800 text-ink-200 active:bg-ink-700',
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Notice({ kind = 'info', children }: { kind?: 'info' | 'warn' | 'error' | 'ok'; children: ReactNode }) {
  const styles = {
    info: 'bg-sky-950/60 text-sky-200 ring-sky-900',
    warn: 'bg-amber-950/60 text-amber-200 ring-amber-900',
    error: 'bg-red-950/60 text-red-200 ring-red-900',
    ok: 'bg-emerald-950/60 text-emerald-200 ring-emerald-900',
  }[kind];
  return <div className={cx('rounded-xl px-3 py-2 text-sm ring-1', styles)}>{children}</div>;
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'accent' | 'warn' | 'ok' | 'error' }) {
  const t = {
    neutral: 'bg-ink-700 text-ink-200',
    accent: 'bg-accent/20 text-accent-soft',
    warn: 'bg-amber-900/50 text-amber-200',
    ok: 'bg-emerald-900/50 text-emerald-200',
    error: 'bg-red-900/50 text-red-200',
  }[tone];
  return <span className={cx('rounded-full px-2 py-0.5 text-[11px] font-medium', t)}>{children}</span>;
}

/** Tiny global toast. */
let toastListener: ((msg: { text: string; kind: 'ok' | 'error' }) => void) | null = null;
export function toast(text: string, kind: 'ok' | 'error' = 'ok') {
  toastListener?.({ text, kind });
}
export function Toaster() {
  const [msg, setMsg] = useState<{ text: string; kind: 'ok' | 'error'; key: number } | null>(null);
  useEffect(() => {
    toastListener = (m) => setMsg({ ...m, key: Date.now() });
    return () => {
      toastListener = null;
    };
  }, []);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), msg.kind === 'error' ? 6000 : 2500);
    return () => clearTimeout(t);
  }, [msg]);
  if (!msg) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+8px)] z-50 flex justify-center px-4">
      <div
        key={msg.key}
        className={cx(
          'pointer-events-auto max-w-md rounded-xl px-4 py-3 text-sm shadow-lg ring-1',
          msg.kind === 'error' ? 'bg-red-950 text-red-100 ring-red-800' : 'bg-ink-800 text-white ring-ink-600',
        )}
        onClick={() => setMsg(null)}
      >
        {msg.text}
      </div>
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-ink-700 px-6 py-10 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="text-sm text-ink-400">{children}</div>}
    </div>
  );
}
