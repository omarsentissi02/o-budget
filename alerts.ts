import { formatEUR } from "./money";
import { getCategory } from "./categories";
import type { BudgetStatus, MonthPosition } from "./budget";
import type { Unusual } from "./analytics";
import type { SubscriptionLike } from "./subscriptions";
import { diffDays } from "./recurrence";
import type { DayLoad } from "./tasks";

/**
 * Alertes proactives — règles déterministes (aucun modèle de langage, aucune donnée inventée).
 * Niveaux : info < attention < critical. Chaque alerte a une clé de dédoublonnage : la même situation
 * ne génère qu'une seule notification (elle réapparaît seulement si la période change).
 */
export type AlertLevel = "info" | "attention" | "critical";
export const ALERT_LEVELS: AlertLevel[] = ["info", "attention", "critical"];
export const levelRank = (l: AlertLevel) => ALERT_LEVELS.indexOf(l);

export const ALERT_KINDS = [
  "unusual_spending",
  "budget_threshold",
  "subscription_renewal",
  "obligation_due",
  "negative_balance_risk",
  "task_overdue",
  "task_deadline",
  "duplicate_subscription",
  "overloaded_day",
] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];

export interface AlertDraft {
  dedupeKey: string;
  kind: AlertKind;
  level: AlertLevel;
  title: string;
  body: string;
  link: string;
}

export interface AlertPrefs {
  /** types désactivés */
  disabledKinds: AlertKind[];
  /** niveau minimal affiché */
  minLevel: AlertLevel;
  /** seuil de pré-alerte budget (0.5–0.95) */
  budgetWarnAt: number;
}

export const DEFAULT_ALERT_PREFS: AlertPrefs = { disabledKinds: [], minLevel: "info", budgetWarnAt: 0.8 };

export interface AlertInput {
  today: string;
  month: string;
  position: MonthPosition;
  budgets: { categoryId: string; status: BudgetStatus }[];
  unusual: Unusual[];
  subscriptions: SubscriptionLike[];
  duplicates: SubscriptionLike[][];
  obligations: { id: string; label: string; amountCents: number; dueDate: string; kind?: "subscription" | "recurring" }[];
  tasks: { id: string; title: string; priority: string; dueDate: string | null; dueTime: string | null; open: boolean }[];
  nowTime: string;
  dayLoads: DayLoad[];
}

export function computeAlerts(i: AlertInput, prefs: AlertPrefs = DEFAULT_ALERT_PREFS): AlertDraft[] {
  const out: AlertDraft[] = [];
  const push = (a: AlertDraft) => out.push(a);

  // Risque de solde négatif
  if (i.position.projectedEndCashCents < 0) {
    push({
      dedupeKey: `negative_balance_risk:${i.month}`,
      kind: "negative_balance_risk",
      level: "critical",
      title: "Risque de solde négatif en fin de mois",
      body: `Au rythme actuel, il manquerait environ ${formatEUR(-i.position.projectedEndCashCents)} d'ici la fin du mois (revenus attendus non comptés).`,
      link: "/",
    });
  } else if (i.position.discretionaryCents < 0) {
    push({
      dedupeKey: `negative_balance_risk:${i.month}:tight`,
      kind: "negative_balance_risk",
      level: "attention",
      title: "Budget du mois dépassé",
      body: `Après vos échéances, votre épargne prévue et votre réserve, il manque ${formatEUR(i.position.shortfallCents)}.`,
      link: "/",
    });
  }

  // Seuils de budget
  for (const b of i.budgets) {
    if (b.status.state === "over") {
      push({
        dedupeKey: `budget_threshold:${i.month}:${b.categoryId}:over`,
        kind: "budget_threshold",
        level: "critical",
        title: `Budget « ${getCategory(b.categoryId).label} » dépassé`,
        body: `${formatEUR(b.status.spentCents)} dépensés pour une limite de ${formatEUR(b.status.limitCents)}.`,
        link: "/finances?tab=budgets",
      });
    } else if (b.status.ratio !== null && b.status.ratio >= prefs.budgetWarnAt) {
      push({
        dedupeKey: `budget_threshold:${i.month}:${b.categoryId}:warn`,
        kind: "budget_threshold",
        level: "attention",
        title: `Budget « ${getCategory(b.categoryId).label} » bientôt atteint`,
        body: `${Math.round(b.status.ratio * 100)} % de la limite de ${formatEUR(b.status.limitCents)} déjà utilisés.`,
        link: "/finances?tab=budgets",
      });
    }
  }

  // Dépenses inhabituelles
  for (const u of i.unusual) {
    if (u.kind === "line") {
      push({
        dedupeKey: `unusual_spending:line:${u.line.id}`,
        kind: "unusual_spending",
        level: "info",
        title: `Dépense inhabituelle : ${formatEUR(u.line.amountCents)}`,
        body: u.reason,
        link: "/analyses",
      });
    } else {
      push({
        dedupeKey: `unusual_spending:category:${i.month}:${u.categoryId}`,
        kind: "unusual_spending",
        level: "attention",
        title: "Catégorie en forte hausse",
        body: u.reason,
        link: "/analyses",
      });
    }
  }

  // Renouvellements d'abonnements
  for (const s of i.subscriptions) {
    if (!s.renewalDate || (s.status !== "active" && s.status !== "trial")) continue;
    const d = diffDays(i.today, s.renewalDate);
    if (d < 0 || d > 7) continue;
    push({
      dedupeKey: `subscription_renewal:${s.id}:${s.renewalDate}`,
      kind: "subscription_renewal",
      level: d <= 3 ? "attention" : "info",
      title: `${s.name} se renouvelle ${d === 0 ? "aujourd'hui" : d === 1 ? "demain" : `dans ${d} jours`}`,
      body: `${formatEUR(s.amountCents)} seront prélevés${s.status === "trial" ? " (fin de la période d'essai)" : ""}.`,
      link: "/finances?tab=abonnements",
    });
  }

  // Échéances
  // Les renouvellements d'abonnement ont leur propre alerte : pas de doublon.
  for (const o of i.obligations.filter((x) => x.kind !== "subscription")) {
    const d = diffDays(i.today, o.dueDate);
    if (d > 3) continue;
    push({
      dedupeKey: `obligation_due:${o.id}:${o.dueDate}`,
      kind: "obligation_due",
      level: d < 0 ? "critical" : "attention",
      title: d < 0 ? `Échéance en retard : ${o.label}` : `Échéance ${d === 0 ? "aujourd'hui" : `dans ${d} j`} : ${o.label}`,
      body: `${formatEUR(o.amountCents)} à régler.`,
      link: "/finances?tab=budgets",
    });
  }

  // Doublons
  for (const g of i.duplicates) {
    push({
      dedupeKey: `duplicate_subscription:${g.map((s) => s.id).sort().join("+")}`,
      kind: "duplicate_subscription",
      level: "info",
      title: "Abonnements en double possibles",
      body: `${g.map((s) => s.name).join(" / ")} se ressemblent : vérifiez que vous avez besoin des deux.`,
      link: "/finances?tab=abonnements",
    });
  }

  // Tâches
  const overdue = i.tasks.filter((t) => t.open && t.dueDate && (t.dueDate < i.today || (t.dueDate === i.today && t.dueTime !== null && t.dueTime < i.nowTime)));
  if (overdue.length > 0) {
    const urgent = overdue.some((t) => t.priority === "urgent");
    push({
      dedupeKey: `task_overdue:${i.today}`,
      kind: "task_overdue",
      level: urgent || overdue.length >= 5 ? "critical" : "attention",
      title: `${overdue.length} tâche${overdue.length > 1 ? "s" : ""} en retard`,
      body: overdue.slice(0, 3).map((t) => t.title).join(", ") + (overdue.length > 3 ? "…" : ""),
      link: "/taches",
    });
  }
  for (const t of i.tasks) {
    if (!t.open || !t.dueDate || (t.priority !== "urgent" && t.priority !== "important")) continue;
    const d = diffDays(i.today, t.dueDate);
    if (d < 0 || d > 1) continue;
    push({
      dedupeKey: `task_deadline:${t.id}:${t.dueDate}`,
      kind: "task_deadline",
      level: t.priority === "urgent" ? "attention" : "info",
      title: `Échéance ${d === 0 ? "aujourd'hui" : "demain"} : ${t.title}`,
      body: t.dueTime ? `Avant ${t.dueTime}.` : "Tâche prioritaire à terminer.",
      link: "/taches",
    });
  }
  for (const l of i.dayLoads) {
    if (!l.overloaded) continue;
    push({
      dedupeKey: `overloaded_day:${l.date}`,
      kind: "overloaded_day",
      level: "info",
      title: "Journée très chargée à venir",
      body: `${l.count} tâches (${Math.round(l.minutes / 60)} h estimées) le ${l.date.split("-").reverse().join("/")}. Pensez à en déplacer.`,
      link: "/taches",
    });
  }

  const min = levelRank(prefs.minLevel);
  return out.filter((a) => !prefs.disabledKinds.includes(a.kind) && levelRank(a.level) >= min);
}

