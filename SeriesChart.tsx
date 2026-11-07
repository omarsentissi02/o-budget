import { useState } from "react";
import type { Granularity, SeriesPoint } from "../../shared/analytics";
import { formatEURRounded } from "../../shared/money";
import { monthShort } from "../../shared/month";

export function bucketLabel(key: string, g: Granularity): string {
  if (g === "month") return monthShort(key).replace(".", "");
  if (g === "year") return key;
  const [, m, d] = key.split("-");
  return `${d}/${m}`;
}

/** Barres revenus (reçus) / dépenses par période. Cliquer sur une période la sélectionne. */
export function SeriesChart({ series, granularity, selected, onSelect }: { series: SeriesPoint[]; granularity: Granularity; selected: string | null; onSelect: (key: string | null) => void }) {
  const [hover, setHover] = useState<string | null>(null);
  const max = Math.max(1, ...series.flatMap((p) => [p.incomeCents, p.expenseCents]));
  const W = 400, H = 200, pad = 12, innerW = W - pad * 2;
  const slot = innerW / Math.max(1, series.length);
  const bw = Math.min(14, slot / 2.6);
  const y = (v: number) => H - 28 - (v / max) * (H - 48);
  const every = Math.ceil(series.length / 6);
  const active = series.find((p) => p.key === (hover ?? selected));

  return (
    <div>
      <div className="mb-2 flex min-h-10 items-center justify-between gap-3 text-sm">
        <div className="flex gap-4 text-muted">
          <span className="inline-flex items-center gap-1.5"><span aria-hidden className="size-2.5 rounded-sm" style={{ background: "var(--chart-2)" }} />Revenus reçus</span>
          <span className="inline-flex items-center gap-1.5"><span aria-hidden className="size-2.5 rounded-sm" style={{ background: "var(--chart-1)" }} />Dépenses</span>
        </div>
        {active && (
          <span className="num text-right text-xs">
            <span className="font-semibold">{bucketLabel(active.key, granularity)}</span> · +{formatEURRounded(active.incomeCents)} / −{formatEURRounded(active.expenseCents)}
          </span>
        )}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Revenus reçus et dépenses par période">
        <line x1={pad} x2={W - pad} y1={H - 28} y2={H - 28} stroke="var(--line)" />
        {series.map((p, i) => {
          const cx = pad + slot * i + slot / 2;
          const isSel = selected === p.key;
          return (
            <g key={p.key} onMouseEnter={() => setHover(p.key)} onMouseLeave={() => setHover(null)}>
              <rect x={cx - slot / 2} y={0} width={slot} height={H - 20} fill={isSel ? "var(--accent-soft)" : "transparent"} rx={6} className="cursor-pointer" onClick={() => onSelect(isSel ? null : p.key)} />
              <rect x={cx - bw - 1} y={y(p.incomeCents)} width={bw} height={Math.max(0, H - 28 - y(p.incomeCents))} rx={3} fill="var(--chart-2)" pointerEvents="none" />
              <rect x={cx + 1} y={y(p.expenseCents)} width={bw} height={Math.max(0, H - 28 - y(p.expenseCents))} rx={3} fill="var(--chart-1)" pointerEvents="none" />
              {i % every === 0 && <text x={cx} y={H - 8} textAnchor="middle" fontSize="12" fill="var(--faint)">{bucketLabel(p.key, granularity)}</text>}
            </g>
          );
        })}
      </svg>
      <details className="mt-2">
        <summary className="cursor-pointer text-sm font-semibold text-accent">Voir les chiffres</summary>
        <div className="mt-2 max-h-64 overflow-auto">
          <table className="num w-full text-sm">
            <thead><tr className="text-left text-xs text-faint"><th className="py-1 font-medium">Période</th><th className="font-medium">Revenus</th><th className="font-medium">Dépenses</th><th className="text-right font-medium">Solde</th></tr></thead>
            <tbody>
              {series.map((p) => (
                <tr key={p.key} className="border-t border-line/60"><td className="py-1.5">{bucketLabel(p.key, granularity)}</td><td>{formatEURRounded(p.incomeCents)}</td><td>{formatEURRounded(p.expenseCents)}</td><td className="text-right">{formatEURRounded(p.netCents)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
