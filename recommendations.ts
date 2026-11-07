import type { AlertLevel } from "./alerts";
import type { MonthPosition } from "./budget";
import { formatEUR } from "./money";
import { getCategory } from "./categories";
import type { DayLoad, TaskBuckets, TaskLike } from "./tasks";
import { diffDays } from "./recurrence";

/**
 * Recommandations DÉTERMINISTES (aucun modèle de langage) : finance, productivité et croisement des deux.
 * Chaque phrase est construite à partir de chiffres calculés ; rien n'est inventé ni estimé « à vue d'œil ».
 */
export interface Recommendation {
  domain: "finance" | "productivity" | "unified";
  level: AlertLevel;
  title: string;
  body: string;
}

export interface RecommendationInput {
  today: string;
  position: MonthPosition;
  topCategories: { categoryId: string; amountCents: number; percent: number }[];
  subscriptionsMonthlyCents: number;
  subscriptionsCount: number;
  duplicateGroups: number;
  taskBuckets: TaskBuckets<TaskLike>;
  loads: DayLoad[];
  upcomingTrips: { date: string; to: string | null; amountCents: number }[];
}

const fmtDate = (iso: string) => iso.split("-").reverse().slice(0, 2).join("/");

export function buildRecommendations(i: RecommendationInput): Recommendation[] {
  const out: Recommendation[] = [];
  const p = i.position;

  // --- Finance
  if (p.remainingDays > 0) {
    if (p.discretionaryCents > 0) {
      out.push({
        domain: "finance",
        level: p.status === "tight" ? "attention" : "info",
        title: `Dépense conseillée : ${formatEUR(p.dailyAllowanceCents)} par jour`,
        body: `(${formatEUR(p.availableFundsCents)} disponibles − ${formatEUR(p.obligationsDueCents)} d'échéances − ${formatEUR(p.plannedSavingsRemainingCents)} d'épargne prévue − ${formatEUR(p.safetyReserveCents)} de réserve) ÷ ${p.remainingDays} jours restants.`,
      });
    } else {
      out.push({
        domain: "finance",
        level: "critical",
        title: "Aucune marge de dépense ce mois-ci",
        body: `Après vos échéances, votre épargne prévue et votre réserve, il manque ${formatEUR(p.shortfallCents)}. Les revenus attendus (${formatEUR(p.expectedIncomeCents)}) ne sont pas comptés tant qu'ils ne sont pas reçus.`,
      });
    }
    if (p.variableRunRateCents > 0) {
      out.push({
        domain: "finance",
        level: p.projectedEndCashCents < 0 ? "critical" : "info",
        title: `Solde projeté en fin de mois : ${formatEUR(p.projectedEndCashCents)}`,
        body: `Au rythme actuel de ${formatEUR(p.variableRunRateCents)} par jour de dépenses variables, sans compter les revenus attendus.`,
      });
    }
  }
  const top = i.topCategories[0];
  if (top && top.amountCents > 0) {
    out.push({
      domain: "finance",
      level: "info",
      title: `Première catégorie : ${getCategory(top.categoryId).label}`,
      body: `${formatEUR(top.amountCents)} (${top.percent.toFixed(0)} % de vos dépenses de la période).`,
    });
  }
  if (i.subscriptionsCount > 0) {
    out.push({
      domain: "finance",
      level: i.duplicateGroups > 0 ? "attention" : "info",
      title: `Abonnements : ${formatEUR(i.subscriptionsMonthlyCents)} par mois`,
      body: i.duplicateGroups > 0 ? `${i.duplicateGroups} groupe(s) d'abonnements semblables à vérifier pour éviter de payer deux fois.` : `Soit ${formatEUR(i.subscriptionsMonthlyCents * 12)} par an.`,
    });
  }

  // --- Productivité
  const b = i.taskBuckets;
  if (b.overdue.length > 0) {
    out.push({
      domain: "productivity",
      level: b.overdue.some((t) => t.priority === "urgent") ? "critical" : "attention",
      title: `${b.overdue.length} tâche(s) en retard`,
      body: `Commencez par « ${b.overdue[0].title} » : c'est la plus prioritaire.`,
    });
  }
  const todayMinutes = b.today.reduce((s, t) => s + (t.estimatedMinutes ?? 0), 0);
  if (b.today.length > 0) {
    out.push({
      domain: "productivity",
      level: "info",
      title: `Aujourd'hui : ${b.today.length} tâche(s)`,
      body: todayMinutes > 0 ? `Environ ${Math.round(todayMinutes / 60 * 10) / 10} h estimées. Première priorité : « ${b.today[0].title} ».` : `Première priorité : « ${b.today[0].title} ».`,
    });
  }
  const overloaded = i.loads.filter((l) => l.overloaded);
  if (overloaded.length > 0) {
    const lightest = [...i.loads].filter((l) => !l.overloaded).sort((a, c) => a.minutes - c.minutes || a.count - c.count)[0];
    out.push({
      domain: "productivity",
      level: "attention",
      title: `Journée chargée le ${fmtDate(overloaded[0].date)}`,
      body: `${overloaded[0].count} tâches${overloaded[0].minutes ? `, ${Math.round(overloaded[0].minutes / 60)} h estimées` : ""}.` + (lightest ? ` Le ${fmtDate(lightest.date)} est plus léger : vous pouvez y déplacer des tâches non urgentes (rien n'est modifié sans votre accord).` : ""),
    });
  }

  // --- Argent × temps
  for (const t of i.upcomingTrips.slice(0, 2)) {
    const d = diffDays(i.today, t.date);
    out.push({
      domain: "unified",
      level: "info",
      title: `Voyage ${t.to ? `vers ${t.to} ` : ""}le ${fmtDate(t.date)} (dans ${d} j)`,
      body: `Billet de ${formatEUR(t.amountCents)} déjà enregistré. Pensez à planifier vos préparatifs dans Tâches ; budget disponible actuel : ${formatEUR(Math.max(0, p.availableFundsCents))}.`,
    });
  }
  if (p.obligationsDueCents > 0 && b.overdue.length + b.today.length > 5) {
    out.push({
      domain: "unified",
      level: "info",
      title: "Semaine chargée et échéances à venir",
      body: `${formatEUR(p.obligationsDueCents)} d'échéances restent à régler ce mois-ci : prévoyez un créneau dans vos tâches pour ne pas les oublier.`,
    });
  }
  return out;
}
