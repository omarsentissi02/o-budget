import { normalizeText } from "./merchants";
import type { CategoryId } from "./categories";
import type { Frequency } from "./income";
import { addDaysISO, addMonthsISO, diffDays, monthlyEquivalentCents, parseISO, yearlyEquivalentCents } from "./recurrence";

export const SUBSCRIPTION_FAMILIES = [
  { id: "pro", label: "Pro & freelance", categoryId: "abonnements" as CategoryId, subcategoryId: "abo_pro" },
  { id: "personal", label: "Personnel & télécoms", categoryId: "telecom" as CategoryId, subcategoryId: "mobile" },
  { id: "transport", label: "Transport", categoryId: "transport" as CategoryId, subcategoryId: "navigo" },
] as const;
export type SubscriptionFamily = (typeof SUBSCRIPTION_FAMILIES)[number]["id"];
export const SUBSCRIPTION_FAMILY_IDS = SUBSCRIPTION_FAMILIES.map((f) => f.id) as [SubscriptionFamily, ...SubscriptionFamily[]];
export const familyLabel = (id: string) => SUBSCRIPTION_FAMILIES.find((f) => f.id === id)?.label ?? id;

export const SUBSCRIPTION_STATUSES = [
  { id: "active", label: "Actif" },
  { id: "trial", label: "Période d'essai" },
  { id: "paused", label: "En pause" },
  { id: "cancelled", label: "Résilié" },
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number]["id"];
export const SUBSCRIPTION_STATUS_IDS = SUBSCRIPTION_STATUSES.map((s) => s.id) as [SubscriptionStatus, ...SubscriptionStatus[]];

/** Suggestions de saisie rapide (noms uniquement : aucun montant n'est supposé). */
export const SUBSCRIPTION_PRESETS: { name: string; family: SubscriptionFamily }[] = [
  { name: "Canva", family: "pro" },
  { name: "ChatGPT", family: "pro" },
  { name: "Adobe Creative Cloud", family: "pro" },
  { name: "Free Mobile", family: "personal" },
  { name: "Box internet", family: "personal" },
  { name: "Navigo", family: "transport" },
  { name: "Vélib'", family: "transport" },
];

export interface SubscriptionLike {
  id: string;
  name: string;
  family: SubscriptionFamily;
  amountCents: number;
  frequency: Frequency;
  status: SubscriptionStatus;
  renewalDate: string | null;
}

/** Un abonnement coûte de l'argent tant qu'il est actif ou en essai avec un montant renseigné. */
export const isCosting = (s: Pick<SubscriptionLike, "status">) => s.status === "active" || s.status === "trial";

export interface SubscriptionCosts {
  monthlyCents: number;
  yearlyCents: number;
  byFamily: Record<SubscriptionFamily, { monthlyCents: number; yearlyCents: number; count: number }>;
}

export function subscriptionCosts(subs: SubscriptionLike[]): SubscriptionCosts {
  const byFamily = {
    pro: { monthlyCents: 0, yearlyCents: 0, count: 0 },
    personal: { monthlyCents: 0, yearlyCents: 0, count: 0 },
    transport: { monthlyCents: 0, yearlyCents: 0, count: 0 },
  } satisfies SubscriptionCosts["byFamily"];
  let monthlyCents = 0;
  let yearlyCents = 0;
  for (const s of subs) {
    if (!isCosting(s)) continue;
    const m = monthlyEquivalentCents(s.amountCents, s.frequency);
    const y = yearlyEquivalentCents(s.amountCents, s.frequency);
    monthlyCents += m;
    yearlyCents += y;
    byFamily[s.family].monthlyCents += m;
    byFamily[s.family].yearlyCents += y;
    byFamily[s.family].count += 1;
  }
  return { monthlyCents, yearlyCents, byFamily };
}

export function upcomingRenewals<T extends SubscriptionLike>(subs: T[], today: string, withinDays: number): (T & { inDays: number })[] {
  return subs
    .filter((s) => isCosting(s) && s.renewalDate)
    .map((s) => ({ ...s, inDays: diffDays(today, s.renewalDate as string) }))
    .filter((s) => s.inDays <= withinDays)
    .sort((a, b) => a.inDays - b.inDays);
}

/**
 * Doublons potentiels : même nom normalisé, ou un nom contenu dans l'autre (≥ 4 caractères),
 * parmi les abonnements non résiliés. Ce n'est qu'un signalement : l'utilisateur décide.
 */
export function findDuplicateSubscriptions<T extends SubscriptionLike>(subs: T[]): T[][] {
  const live = subs.filter((s) => s.status !== "cancelled").map((s) => ({ s, n: normalizeText(s.name) }));
  const groups: T[][] = [];
  const used = new Set<string>();
  for (let i = 0; i < live.length; i++) {
    if (used.has(live[i].s.id)) continue;
    const group = [live[i].s];
    for (let j = i + 1; j < live.length; j++) {
      if (used.has(live[j].s.id)) continue;
      const a = live[i].n;
      const b = live[j].n;
      const similar = a === b || (Math.min(a.length, b.length) >= 4 && (a.includes(b) || b.includes(a)));
      if (similar && a !== "" && b !== "") group.push(live[j].s);
    }
    if (group.length > 1) {
      group.forEach((g) => used.add(g.id));
      groups.push(group);
    }
  }
  return groups;
}

/** Prochaine échéance après un paiement ; le jour d'origine (date de début) est conservé. */
export function renewalAfterPayment(renewalDate: string, frequency: Frequency, startDate: string | null): string | null {
  const anchorDay = parseISO(startDate ?? renewalDate).d;
  switch (frequency) {
    case "once":
      return null;
    case "weekly":
      return addDaysISO(renewalDate, 7);
    case "monthly":
      return addMonthsISO(renewalDate, 1, anchorDay);
    case "quarterly":
      return addMonthsISO(renewalDate, 3, anchorDay);
    case "yearly":
      return addMonthsISO(renewalDate, 12, anchorDay);
  }
}
