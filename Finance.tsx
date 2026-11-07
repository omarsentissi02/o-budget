import { lazy, Suspense } from "react";
import { useSearchParams } from "react-router-dom";
import { PageHeader, Tabs } from "../components/v2";
import { Skeleton } from "../components/ui";

const History = lazy(() => import("./History"));
const Incomes = lazy(() => import("./finance/Incomes"));
const Subscriptions = lazy(() => import("./finance/Subscriptions"));
const Budgets = lazy(() => import("./finance/Budgets"));
const Savings = lazy(() => import("./finance/Savings"));

const TABS = [
  { value: "transactions", label: "Dépenses" },
  { value: "revenus", label: "Revenus" },
  { value: "abonnements", label: "Abonnements" },
  { value: "budgets", label: "Budgets" },
  { value: "epargne", label: "Épargne" },
] as const;
type Tab = (typeof TABS)[number]["value"];

export default function Finance() {
  const [params, setParams] = useSearchParams();
  const raw = params.get("tab");
  const tab: Tab = TABS.some((t) => t.value === raw) ? (raw as Tab) : "transactions";
  const go = (t: Tab) => {
    const next = new URLSearchParams(params);
    next.set("tab", t);
    next.delete("nouveau");
    setParams(next, { replace: true });
  };
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Finances" />
      <Tabs label="Sections des finances" value={tab} onChange={go} tabs={[...TABS]} />
      <Suspense fallback={<Skeleton className="h-64 rounded-[26px]" />}>
        {tab === "transactions" && <History />}
        {tab === "revenus" && <Incomes />}
        {tab === "abonnements" && <Subscriptions />}
        {tab === "budgets" && <Budgets />}
        {tab === "epargne" && <Savings />}
      </Suspense>
    </div>
  );
}
