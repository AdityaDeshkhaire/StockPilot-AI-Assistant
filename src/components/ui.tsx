import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { subscribe, type Notice } from '../services/events';

export function Card({ children, className = '', title, actions }: { children: ReactNode; className?: string; title?: ReactNode; actions?: ReactNode }) {
  return (
    <section className={`rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          {title && <h2 className="text-base">{title}</h2>}
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'ai';
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-navy text-white hover:bg-navy-light disabled:bg-slate-300',
  secondary: 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:text-slate-400',
  danger: 'bg-red-600 text-white hover:bg-red-700 disabled:bg-slate-300',
  ghost: 'text-navy hover:bg-navy/5',
  ai: 'border border-ai-border bg-ai-bg text-ai-text hover:bg-[#ece4ff]',
};

export function Button({ variant = 'primary', busy, children, className = '', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; busy?: boolean }) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || busy}
      className={`inline-flex items-center justify-center gap-2 rounded-md px-3.5 py-2 text-sm font-medium transition disabled:cursor-not-allowed ${VARIANTS[variant]} ${className}`}
    >
      {busy && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />}
      {children}
    </button>
  );
}

const CHIP_TONES: Record<string, string> = {
  red: 'bg-red-50 text-red-700 ring-red-200',
  amber: 'bg-amber-50 text-amber-800 ring-amber-200',
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  blue: 'bg-sky-50 text-sky-700 ring-sky-200',
  slate: 'bg-slate-100 text-slate-600 ring-slate-200',
  purple: 'bg-ai-bg text-ai-text ring-ai-border',
  navy: 'bg-navy/10 text-navy ring-navy/20',
};

export function Chip({ tone = 'slate', children }: { tone?: keyof typeof CHIP_TONES; children: ReactNode }) {
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${CHIP_TONES[tone]}`}>{children}</span>;
}

const STATUS_TONE: Record<string, keyof typeof CHIP_TONES> = {
  Draft: 'slate',
  Pending_Approval: 'amber',
  Pending: 'amber',
  Escalated: 'red',
  Approved: 'green',
  Approved_With_Edits: 'green',
  Auto_Approved: 'blue',
  Rejected: 'red',
  Converted: 'navy',
  Sent: 'blue',
  Acknowledged: 'blue',
  Partially_Received: 'amber',
  Received: 'green',
  Closed: 'slate',
  Cancelled: 'slate',
  Accepted: 'green',
  Partially_Accepted: 'amber',
  Open: 'amber',
  Completed: 'green',
  No_Action: 'slate',
  Short: 'red',
  Over: 'amber',
  Damaged: 'red',
  Wrong_Item: 'red',
  Price_Mismatch: 'amber',
  Credit_Requested: 'blue',
  Replacement_Requested: 'blue',
  Returned: 'slate',
  Accepted_As_Is: 'green',
  Below_ROP: 'red',
  Periodic_Review: 'amber',
  Manual: 'navy',
  OK: 'green',
  Low: 'amber',
  Critical: 'red',
};

export const label = (s: string) => s.replace(/_/g, ' ');

export function StatusChip({ status }: { status: string }) {
  return <Chip tone={STATUS_TONE[status] ?? 'slate'}>{label(status)}</Chip>;
}

/** AI content is always shown in a purple panel. */
export function AIPanel({ title = 'AI draft', children, source, className = '' }: { title?: string; children: ReactNode; source?: string; className?: string }) {
  return (
    <div className={`rounded-lg border border-ai-border bg-ai-bg p-4 text-ai-text ${className}`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <span aria-hidden>✦</span>
          {title}
        </div>
        <span className="text-[11px] font-medium uppercase tracking-wide opacity-70">{source ? `${source} · ` : ''}AI drafts · humans decide</span>
      </div>
      <div className="text-sm leading-relaxed">{children}</div>
    </div>
  );
}

export function ErrorCard({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
      <div className="font-semibold">{title}</div>
      {children && <div className="mt-1">{children}</div>}
    </div>
  );
}

export function Kpi({ label: l, value, tone = 'navy', hint }: { label: string; value: ReactNode; tone?: 'navy' | 'red' | 'amber' | 'green'; hint?: string }) {
  const color = { navy: 'text-navy', red: 'text-red-600', amber: 'text-amber-600', green: 'text-emerald-600' }[tone];
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{l}</div>
      <div className={`mt-1 text-3xl font-semibold tabular-nums ${color}`}>{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1>{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">{children}</div>;
}

export function TableWrap({ children }: { children: ReactNode }) {
  return <div className="overflow-x-auto">{children}</div>;
}

export function Notices() {
  const [items, setItems] = useState<Notice[]>([]);
  useEffect(
    () =>
      subscribe((n) => {
        setItems((xs) => [...xs, n]);
        setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== n.id)), n.kind === 'error' ? 9000 : 5000);
      }),
    [],
  );
  const tone = { error: 'border-red-300 bg-red-50 text-red-800', warning: 'border-amber-300 bg-amber-50 text-amber-900', info: 'border-sky-300 bg-sky-50 text-sky-900', success: 'border-emerald-300 bg-emerald-50 text-emerald-800' };
  return (
    <div className="fixed bottom-4 right-4 z-50 flex w-[22rem] max-w-[calc(100vw-2rem)] flex-col gap-2">
      {items.map((n) => (
        <div key={n.id} className={`rounded-lg border p-3 text-sm shadow-lg ${tone[n.kind]}`}>
          <div className="flex items-start justify-between gap-2">
            <div className="font-semibold">{n.title}</div>
            <button className="opacity-60 hover:opacity-100" onClick={() => setItems((xs) => xs.filter((x) => x.id !== n.id))} aria-label="Dismiss">
              ×
            </button>
          </div>
          {n.body && <div className="mt-1">{n.body}</div>}
        </div>
      ))}
    </div>
  );
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 pt-16" onClick={onClose}>
      <div className={`w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} rounded-xl bg-white shadow-xl`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <h2>{title}</h2>
          <button onClick={onClose} className="text-2xl leading-none text-slate-400 hover:text-slate-700" aria-label="Close">
            ×
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}
