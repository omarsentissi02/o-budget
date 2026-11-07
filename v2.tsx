import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, CircleAlert, Info } from "lucide-react";
import type { AlertLevel } from "../../shared/alerts";
import { formatEUR } from "../../shared/money";
import { getCategory } from "../../shared/categories";

export const money = formatEUR;

const levelStyle: Record<AlertLevel, string> = {
  info: "bg-accent-soft text-info",
  attention: "bg-warn-soft text-warn",
  critical: "bg-danger-soft text-danger",
};
export const levelLabel: Record<AlertLevel, string> = { info: "Info", attention: "Attention", critical: "Critique" };

export function LevelBadge({ level }: { level: AlertLevel }) {
  const Icon = level === "info" ? Info : level === "attention" ? AlertTriangle : CircleAlert;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${levelStyle[level]}`}>
      <Icon size={13} aria-hidden /> {levelLabel[level]}
    </span>
  );
}

export function Pill({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "ok" | "warn" | "danger" | "accent" }) {
  const t = {
    neutral: "bg-raised text-muted",
    ok: "bg-save-soft text-save",
    warn: "bg-warn-soft text-warn",
    danger: "bg-danger-soft text-danger",
    accent: "bg-accent-soft text-accent",
  }[tone];
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${t}`}>{children}</span>;
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <header className="flex items-end justify-between gap-3 pt-1">
      <div className="min-w-0">
        <h1 className="text-[26px] leading-8 font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
      </div>
      {action}
    </header>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-2 py-2">
      <p className="text-[15px] font-semibold">{title}</p>
      {children && <p className="text-sm text-muted">{children}</p>}
      {action}
    </div>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "ok" | "danger" | "warn" }) {
  const color = tone === "ok" ? "text-save" : tone === "danger" ? "text-danger" : tone === "warn" ? "text-warn" : "text-ink";
  return (
    <div className="min-w-0">
      <p className="text-[13px] font-medium text-muted">{label}</p>
      <p className={`num mt-0.5 text-[clamp(17px,5vw,22px)] leading-7 font-semibold break-words ${color}`}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-faint">{hint}</p>}
    </div>
  );
}

export function Meter({ ratio, state, label }: { ratio: number; state: "ok" | "warning" | "over" | "none"; label: string }) {
  const color = state === "over" ? "bg-danger" : state === "warning" ? "bg-warn" : "bg-save";
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.round(ratio * 100))} className="h-2 overflow-hidden rounded-full bg-raised">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(100, Math.max(2, ratio * 100))}%` }} />
    </div>
  );
}

export function CategoryDot({ id }: { id: string }) {
  return <span aria-hidden className="inline-block size-2.5 shrink-0 rounded-full" style={{ background: getCategory(id)?.color ?? "var(--faint)" }} />;
}

export function Tabs<T extends string>({ value, onChange, tabs, label }: { value: T; onChange: (v: T) => void; tabs: { value: T; label: string }[]; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
      {tabs.map((t) => (
        <button
          key={t.value}
          role="tab"
          type="button"
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
          className={`h-10 shrink-0 rounded-full px-4 text-sm font-semibold transition ${value === t.value ? "bg-ink text-canvas" : "bg-surface text-muted hover:text-ink"}`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Row({ children, to, onClick }: { children: ReactNode; to?: string; onClick?: () => void }) {
  const cls = "flex w-full items-center gap-3 border-b border-line/60 py-3 text-left last:border-0";
  if (to) return <Link to={to} className={cls}>{children}</Link>;
  if (onClick) return <button type="button" onClick={onClick} className={cls}>{children}</button>;
  return <div className={cls}>{children}</div>;
}

export function Select({ value, onChange, children, id, label }: { value: string; onChange: (v: string) => void; children: ReactNode; id?: string; label?: string }) {
  return (
    <select id={id} aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className="h-12 w-full rounded-2xl border border-line bg-surface px-3 text-[16px] text-ink outline-none focus:border-accent focus:ring-4 focus:ring-accent/15">
      {children}
    </select>
  );
}

export const shortDate = (iso: string) => iso.split("-").reverse().slice(0, 2).join("/");
export const pct = (v: number | null) => (v === null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(0)} %`);
