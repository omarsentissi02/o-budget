import { useLayoutEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { TrendingDown, TrendingUp, Minus } from "lucide-react";
import { formatEUR, formatEURRounded, formatPercent } from "../../shared/money";
import { currentMonthKey, monthLabel, monthName, monthShort } from "../../shared/month";
import { percentChange } from "../../shared/finance";
import type { AnalysisMonthDTO } from "../../shared/types";
import { useAnalysis } from "../lib/queries";
import { errorMessage } from "../lib/api";
import { useSelectedMonth } from "../hooks/MonthContext";
import { ErrorState, Panel, SectionTitle, Segmented, Skeleton } from "../components/ui";

type SeriesKey = "incomeCents" | "expenseCents" | "savingsCents" | "remainingCents";
const SERIES: { key: SeriesKey; label: string; color: string }[] = [
  { key: "incomeCents", label: "Revenus", color: "var(--faint)" },
  { key: "expenseCents", label: "Dépenses", color: "var(--ink)" },
  { key: "savingsCents", label: "Épargne", color: "var(--save)" },
  { key: "remainingCents", label: "Reste", color: "var(--accent)" },
];

function niceMax(v: number) {
  if (v <= 0) return 10000;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}

function MonthlyChart({ data, visible }: { data: AnalysisMonthDTO[]; visible: SeriesKey[] }) {
  const series = SERIES.filter((s) => visible.includes(s.key));
  const values = data.flatMap((d) => series.map((s) => d[s.key]));
  const max = niceMax(Math.max(...values, 0));
  const minRaw = Math.min(...values, 0);
  const min = minRaw < 0 ? -niceMax(-minRaw) : 0;
  const padL = 56;
  const W = padL + data.length * 58;
  const H = 240;
  const padB = 28;
  const plotH = H - padB - 8;
  const y = (v: number) => 8 + ((max - v) / (max - min)) * plotH;
  const groupW = (W - padL) / data.length;
  const barW = Math.min(18, (groupW * 0.72) / Math.max(series.length, 1));
  const ticks = [max, max / 2, 0, ...(min < 0 ? [min] : [])];

  const scroller = useRef<HTMLDivElement>(null);
  // Sur 12 mois, le graphique défile : on affiche d'abord les mois les plus récents.
  useLayoutEffect(() => {
    if (scroller.current) scroller.current.scrollLeft = scroller.current.scrollWidth;
  }, [data.length]);

  return (
    <div ref={scroller} className="-mx-1 overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ minWidth: data.length > 6 ? W * 0.9 : undefined }} role="img" aria-label="Graphique des revenus, dépenses, épargne et reste par mois">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeDasharray={t === 0 ? undefined : "3 4"} />
            <text x={padL - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--faint)" className="num">
              {formatEURRounded(t)}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const gx = padL + i * groupW + (groupW - barW * series.length) / 2;
          return (
            <g key={d.month}>
              {series.map((s, j) => {
                const v = d[s.key];
                const top = v >= 0 ? y(v) : y(0);
                const h = Math.max(Math.abs(y(v) - y(0)), v !== 0 ? 1.5 : 0);
                return (
                  <rect key={s.key} x={gx + j * barW + 1} y={top} width={barW - 2} height={h} rx={3} fill={s.color} className="anim-fade">
                    <title>{`${monthLabel(d.month)}, ${s.label} : ${formatEUR(v)}`}</title>
                  </rect>
                );
              })}
              <text x={padL + i * groupW + groupW / 2} y={H - 8} textAnchor="middle" fontSize="12" fill="var(--muted)">
                {monthShort(d.month)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function Trend({ prev, cur, goodWhenDown }: { prev: number; cur: number; goodWhenDown: boolean }) {
  const pct = percentChange(prev, cur);
  if (pct === null || Math.abs(pct) < 0.05) return <Minus size={16} className="text-faint" aria-label="Stable" />;
  const up = pct > 0;
  const good = up !== goodWhenDown;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span className={`num inline-flex items-center gap-1 text-[13px] font-semibold ${good ? "text-save" : "text-danger"}`}>
      <Icon size={15} aria-hidden />
      {up ? "+" : ""}
      {formatPercent(pct)}
    </span>
  );
}

function Insight({ data }: { data: AnalysisMonthDTO[] }) {
  const cur = data[data.length - 1];
  const prev = data[data.length - 2];
  if (!cur || !prev || (prev.expenseCents === 0 && cur.expenseCents === 0)) return null;
  const diff = cur.expenseCents - prev.expenseCents;
  const sentence =
    prev.expenseCents === 0
      ? `Aucune dépense saisie en ${monthName(prev.month)} pour comparer.`
      : diff === 0
        ? `Vos dépenses sont identiques à celles de ${monthName(prev.month)}.`
        : `Vous avez dépensé ${formatEUR(Math.abs(diff))} de ${diff > 0 ? "plus" : "moins"} qu'en ${monthName(prev.month)}.`;
  return (
    <Panel>
      <p className="text-[13px] text-faint">{monthLabel(cur.month)} comparé au mois précédent</p>
      <p className="mt-1 text-[19px] leading-snug font-semibold tracking-tight">{sentence}</p>
    </Panel>
  );
}

export default function Analysis() {
  const { month, setMonth } = useSelectedMonth();
  const navigate = useNavigate();
  const [count, setCount] = useState<"3" | "6" | "12">("6");
  const [visible, setVisible] = useState<SeriesKey[]>(SERIES.map((s) => s.key));
  const end = month > currentMonthKey() ? month : currentMonthKey();
  const analysis = useAnalysis(end, Number(count));

  const toggle = (k: SeriesKey) =>
    setVisible((v) => (v.includes(k) ? (v.length > 1 ? v.filter((x) => x !== k) : v) : [...v, k]));

  const all = [...(analysis.data ?? [])].reverse();
  const hasData = (m: AnalysisMonthDTO) => m.incomeCents > 0 || m.expenseCents > 0 || m.savingsCents > 0;
  const rows = all.filter(hasData);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="pt-1 text-center text-[26px] font-semibold tracking-tight">Analyse</h1>
      <Segmented
        label="Période"
        value={count}
        onChange={setCount}
        options={[
          { value: "3", label: "3 mois" },
          { value: "6", label: "6 mois" },
          { value: "12", label: "12 mois" },
        ]}
      />

      {analysis.isError ? (
        <ErrorState message={errorMessage(analysis.error)} onRetry={() => analysis.refetch()} />
      ) : !analysis.data ? (
        <Skeleton className="h-80 rounded-[26px]" />
      ) : (
        <>
          <Insight data={analysis.data} />

          <Panel aria-labelledby="chart-title">
            <SectionTitle id="chart-title">Évolution mensuelle</SectionTitle>
            <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Séries affichées">
              {SERIES.map((s) => {
                const on = visible.includes(s.key);
                return (
                  <button
                    key={s.key}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggle(s.key)}
                    className={`inline-flex h-9 items-center gap-2 rounded-full px-3 text-[13px] font-medium transition ${on ? "bg-raised text-ink" : "text-faint line-through"}`}
                  >
                    <span aria-hidden className="size-2.5 rounded-full" style={{ background: s.color }} />
                    {s.label}
                  </button>
                );
              })}
            </div>
            <MonthlyChart data={analysis.data} visible={visible} />
          </Panel>

          <Panel aria-labelledby="months-title">
            <SectionTitle id="months-title">Mois par mois</SectionTitle>
            <ul className="flex flex-col divide-y divide-line">
              {rows.length === 0 && <li className="py-2 text-[15px] text-muted">Aucune donnée sur cette période. Saisissez vos revenus et vos dépenses pour comparer vos mois.</li>}
              {rows.map((m) => {
                const prev = all[all.indexOf(m) + 1];
                return (
                  <li key={m.month}>
                    <button
                      type="button"
                      onClick={() => {
                        setMonth(m.month);
                        navigate("/");
                      }}
                      className="-mx-2 flex w-[calc(100%+1rem)] flex-col gap-2 rounded-2xl px-2 py-3.5 text-left hover:bg-raised"
                      aria-label={`Ouvrir ${monthLabel(m.month)}`}
                    >
                      <span className="flex items-baseline justify-between">
                        <span className="text-[15px] font-semibold">{monthLabel(m.month)}</span>
                        {prev && prev.expenseCents > 0 && (
                          <span className="flex items-center gap-1.5 text-[13px] text-muted">
                            Dépenses <Trend prev={prev.expenseCents} cur={m.expenseCents} goodWhenDown />
                          </span>
                        )}
                      </span>
                      <span className="grid grid-cols-2 gap-x-6 gap-y-1 text-[14px] sm:grid-cols-4">
                        {SERIES.map((s) => (
                          <span key={s.key} className="flex items-center justify-between gap-2">
                            <span className="text-muted">{s.label}</span>
                            <span className={`num font-medium ${s.key === "remainingCents" && m.remainingCents < 0 ? "text-danger" : ""}`}>
                              {formatEURRounded(m[s.key])}
                              {s.key === "savingsCents" && m.savingsRate !== null && m.savingsCents > 0 && (
                                <span className="ml-1 text-[12px] font-normal text-save">({formatPercent(m.savingsRate)})</span>
                              )}
                            </span>
                          </span>
                        ))}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </Panel>
        </>
      )}
    </div>
  );
}
