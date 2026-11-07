import { useMemo, useState } from "react";
import { ChevronRight, TrendingDown, TrendingUp, X } from "lucide-react";
import { periodRange, type Granularity } from "../../shared/analytics";
import { getCategory } from "../../shared/categories";
import { getSubcategory } from "../../shared/taxonomy";
import { dayFR } from "../../shared/month";
import { errorMessage } from "../lib/api";
import { useAnalyticsOverview, useBreakdown, useTransactions } from "../lib/queries";
import { Panel, SectionTitle, Segmented, Skeleton, ErrorState } from "../components/ui";
import { SeriesChart, bucketLabel } from "../components/SeriesChart";
import { Empty, PageHeader, Pill, money, pct, Select } from "../components/v2";

const GRANS: { value: Granularity; label: string }[] = [
  { value: "day", label: "Jour" }, { value: "week", label: "Semaine" }, { value: "month", label: "Mois" }, { value: "year", label: "Année" },
];
const DIM_LABEL: Record<string, string> = { category: "Catégorie", subcategory: "Sous-catégorie", merchant: "Établissement", platform: "Plateforme", payment: "Paiement", city: "Lieu" };
type Filter = { key: "category" | "sub" | "merchant" | "platform" | "payment" | "place"; value: string; label: string };
const FILTER_DIM: Record<Filter["key"], string> = { category: "category", sub: "subcategory", merchant: "merchant", platform: "platform", payment: "payment", place: "city" };

const anchorOf = (key: string) => (key.length === 4 ? `${key}-01-01` : key.length === 7 ? `${key}-01` : key);

export default function Analytics() {
  const [g, setG] = useState<Granularity>("month");
  const [focus, setFocus] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filter[]>([]);
  const [by, setBy] = useState("category");

  const range = focus ? periodRange(anchorOf(focus), g) : null;
  const base = `granularity=${g}${range ? `&from=${range.from}&to=${range.to}` : ""}`;
  const fq = filters.map((f) => `&${f.key}=${encodeURIComponent(f.value)}`).join("");
  // L'évolution (graphique) montre toujours la période complète ; comparaison, répartition et transactions suivent la sélection.
  const overview = useAnalyticsOverview(`granularity=${g}`);
  const scoped = useAnalyticsOverview(base);
  const breakdown = useBreakdown(`${base}&by=${by}${fq}`);
  const tx = useTransactions(`${base}${fq}`, filters.length > 0);

  const used = new Set(filters.map((f) => FILTER_DIM[f.key]));
  const dims = useMemo(() => Object.keys(DIM_LABEL).filter((d) => !used.has(d)), [filters]); // eslint-disable-line react-hooks/exhaustive-deps

  const changeG = (v: Granularity) => { setG(v); setFocus(null); setFilters([]); setBy("category"); };
  const drill = (rowKey: string, rowLabel: string) => {
    const key = ({ category: "category", subcategory: "sub", merchant: "merchant", platform: "platform", payment: "payment", city: "place" } as const)[by as "category"];
    const next = [...filters, { key, value: rowKey, label: rowLabel }];
    setFilters(next);
    const nextUsed = new Set(next.map((f) => FILTER_DIM[f.key]));
    const order = by === "category" ? ["subcategory", "merchant", "platform"] : by === "subcategory" ? ["platform", "merchant", "payment"] : ["payment", "city", "merchant"];
    setBy(order.find((d) => !nextUsed.has(d)) ?? Object.keys(DIM_LABEL).find((d) => !nextUsed.has(d)) ?? "category");
  };
  const popTo = (n: number) => {
    const next = filters.slice(0, n);
    setFilters(next);
    const u = new Set(next.map((f) => FILTER_DIM[f.key]));
    setBy(["category", "subcategory", "platform", "merchant"].find((d) => !u.has(d)) ?? "category");
  };

  if (overview.isError) return <ErrorState message={errorMessage(overview.error)} onRetry={() => overview.refetch()} />;
  const cmp = scoped.data?.comparison;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Analyses" subtitle="Revenus reçus et dépenses réelles, sans double comptage." />
      <Segmented label="Granularité" value={g} onChange={changeG} options={GRANS} />

      <Panel aria-labelledby="evo-title">
        <SectionTitle id="evo-title" action={focus ? <button type="button" onClick={() => setFocus(null)} className="inline-flex items-center gap-1 text-sm font-semibold text-accent"><X size={14} aria-hidden /> {bucketLabel(focus, g)}</button> : undefined}>Évolution</SectionTitle>
        {!overview.data ? <Skeleton className="h-52" /> : <SeriesChart series={overview.data.series} granularity={g} selected={focus} onSelect={(k) => { setFocus(k); setFilters([]); setBy("category"); }} />}
        <p className="mt-2 text-xs text-faint">Touchez une période pour détailler les dépenses de cette période.</p>
      </Panel>

      {cmp && (
        <Panel aria-labelledby="cmp-title">
          <SectionTitle id="cmp-title">Par rapport à la période précédente</SectionTitle>
          <dl className="grid grid-cols-3 gap-3">
            {([["Revenus reçus", cmp.current.incomeCents, cmp.incomeChangePct, true], ["Dépenses", cmp.current.expenseCents, cmp.expenseChangePct, false], ["Solde", cmp.current.netCents, cmp.netChangePct, true]] as const).map(([label, v, change, upGood]) => {
              const good = change === null ? null : (change >= 0) === upGood;
              return (
                <div key={label}>
                  <dt className="text-[13px] text-muted">{label}</dt>
                  <dd className="num mt-0.5 text-lg font-semibold">{money(v)}</dd>
                  <dd className={`flex items-center gap-1 text-xs ${good === null ? "text-faint" : good ? "text-save" : "text-danger"}`}>
                    {change !== null && (change >= 0 ? <TrendingUp size={13} aria-hidden /> : <TrendingDown size={13} aria-hidden />)}{pct(change)}
                  </dd>
                </div>
              );
            })}
          </dl>
          <p className="mt-3 text-xs text-faint">Précédente : revenus {money(cmp.previous.incomeCents)}, dépenses {money(cmp.previous.expenseCents)}. « — » : pas de période précédente comparable.</p>
        </Panel>
      )}

      <Panel aria-labelledby="bd-title">
        <SectionTitle id="bd-title">Où part l'argent</SectionTitle>
        {filters.length > 0 && (
          <nav aria-label="Chemin d'exploration" className="mb-3 flex flex-wrap items-center gap-1 text-sm">
            <button type="button" onClick={() => popTo(0)} className="font-semibold text-accent">Tout</button>
            {filters.map((f, i) => (
              <span key={i} className="inline-flex items-center gap-1"><ChevronRight size={14} className="text-faint" aria-hidden />
                <button type="button" onClick={() => popTo(i + 1)} className={i === filters.length - 1 ? "font-semibold" : "font-semibold text-accent"}>{f.label}</button></span>
            ))}
          </nav>
        )}
        <div className="mb-3 flex items-center gap-2">
          <label htmlFor="by" className="text-sm text-muted">Regrouper par</label>
          <div className="w-44"><Select id="by" value={by} onChange={setBy}>{dims.map((d) => <option key={d} value={d}>{DIM_LABEL[d]}</option>)}</Select></div>
        </div>
        {breakdown.isError ? <ErrorState message={errorMessage(breakdown.error)} onRetry={() => breakdown.refetch()} /> : !breakdown.data ? <Skeleton className="h-40" /> : breakdown.data.rows.length === 0 ? <Empty title="Aucune dépense sur cette période" /> : (
          <>
            <p className="mb-2 text-sm text-muted">Total <span className="num font-semibold text-ink">{money(breakdown.data.totalCents)}</span></p>
            <ul>
              {breakdown.data.rows.slice(0, 15).map((r) => (
                <li key={r.key}>
                  <button type="button" onClick={() => drill(r.key, r.label)} className="block w-full border-b border-line/60 py-2.5 text-left last:border-0">
                    <div className="flex items-center justify-between gap-3 text-[15px]">
                      <span className="min-w-0 truncate font-medium">{by === "category" ? getCategory(r.key)?.emoji : ""} {r.label}</span>
                      <span className="num shrink-0 font-semibold">{money(r.amountCents)}</span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-raised"><div className="h-full rounded-full" style={{ width: `${Math.max(2, r.percent)}%`, background: "var(--chart-1)" }} /></div>
                      <span className="num w-20 text-right text-xs text-faint">{r.percent.toFixed(0)} % · {r.count} ligne{r.count > 1 ? "s" : ""}</span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </Panel>

      {filters.length > 0 && (
        <Panel aria-labelledby="tx-title">
          <SectionTitle id="tx-title">Dépenses concernées</SectionTitle>
          {!tx.data ? <Skeleton className="h-24" /> : (
            <>
              <p className="mb-2 text-sm text-muted">{tx.data.count} ligne{tx.data.count > 1 ? "s" : ""} · <span className="num font-semibold text-ink">{money(tx.data.totalCents)}</span> (identique au total ci-dessus)</p>
              <ul>
                {tx.data.lines.map((l) => (
                  <li key={l.id} className="flex items-center gap-3 border-b border-line/60 py-2.5 last:border-0">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-medium">{l.merchantLabel ?? getSubcategory(l.subcategoryId)?.label ?? getCategory(l.categoryId).label}</span>
                      <span className="block truncate text-[13px] text-faint">{dayFR(l.date)} · {l.paymentLabel}{l.place ? ` · ${l.place}` : ""}{l.platformId ? <> · <Pill>{l.platformId}</Pill></> : null}</span>
                    </span>
                    <span className="num font-semibold">{money(l.amountCents)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Panel>
      )}

      {scoped.data && scoped.data.unusual.length > 0 && (
        <Panel aria-labelledby="un-title">
          <SectionTitle id="un-title">Dépenses inhabituelles</SectionTitle>
          <ul className="flex flex-col gap-3">
            {scoped.data.unusual.map((u, i) => (
              <li key={i} className="rounded-2xl bg-warn-soft p-3 text-sm text-warn">
                {u.kind === "line" ? <><p className="font-semibold">{money(u.line.amountCents)} · {u.line.merchantLabel ?? getCategory(u.line.categoryId).label} · {dayFR(u.line.date)}</p><p>{u.reason}</p></> : <><p className="font-semibold">{getCategory(u.categoryId).label}: {money(u.currentCents)} ce mois-ci</p><p>{u.reason}</p></>}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-faint">Règles : montant bien au-dessus de l'habitude de la catégorie (historique de 6 mois, au moins 6 dépenses), ou catégorie en forte hausse. Ce sont des signaux, pas des erreurs.</p>
        </Panel>
      )}
    </div>
  );
}
