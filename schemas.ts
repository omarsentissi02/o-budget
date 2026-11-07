import { z } from "zod";
import { CATEGORY_IDS } from "./categories";
import { MAX_AMOUNT_CENTS } from "./money";
import { isMonthKey, isValidISODate, isValidTimeZone } from "./month";
import { CHANNEL_IDS, PLATFORM_IDS } from "./taxonomy";
import { FREQUENCY_IDS, INCOME_KIND_IDS, INCOME_STATUS_IDS } from "./income";
import { SUBSCRIPTION_FAMILY_IDS, SUBSCRIPTION_STATUS_IDS } from "./subscriptions";
import { PRIORITY_IDS, RECURRENCE_IDS, TASK_STATUS_IDS } from "./tasks";
import { ALERT_KINDS, ALERT_LEVELS } from "./alerts";

const amount = (positive: boolean) =>
  z
    .number({ invalid_type_error: "Montant invalide." })
    .int("Montant invalide.")
    .min(positive ? 1 : 0, positive ? "Le montant doit être supérieur à 0 €." : "Le montant ne peut pas être négatif.")
    .max(MAX_AMOUNT_CENTS, "Montant trop élevé.");

const isoDate = z.string().refine(isValidISODate, "Date invalide.");
export const monthKey = z.string().refine(isMonthKey, "Mois invalide.");
const text = (max: number, label: string) =>
  z.string().trim().min(1, `${label} est requis.`).max(max, `${label} est trop long.`);

export const locationSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("france"), city: text(80, "La ville") }),
  z.object({
    type: z.literal("abroad"),
    countryCode: z.string().regex(/^[A-Z]{2}$/).nullable(),
    countryName: text(80, "Le pays"),
  }),
]);

const optText = (max: number) => z.string().trim().max(max, "Texte trop long.").nullable().optional();

export const expenseLineSchema = z.object({
  categoryId: z.enum(CATEGORY_IDS, { message: "Catégorie inconnue." }),
  amountCents: amount(true),
  subcategoryId: z.string().max(64).nullable().optional(),
  merchantId: z.string().max(64).nullable().optional(),
  platformId: z.enum(PLATFORM_IDS, { message: "Plateforme inconnue." }).nullable().optional(),
  tripFrom: optText(80),
  tripTo: optText(80),
  tripDate: isoDate.nullable().optional(),
  note: optText(200),
});

export const expenseInputSchema = z.object({
  date: isoDate,
  location: locationSchema,
  amounts: z
    .array(expenseLineSchema)
    .min(1, "Ajoutez au moins une catégorie avec un montant.")
    .max(CATEGORY_IDS.length)
    .refine((a) => new Set(a.map((x) => x.categoryId)).size === a.length, "Une catégorie apparaît deux fois."),
  /** null = « Autre » moyen de paiement */
  paymentMethodId: z.string().max(64).nullable(),
  description: z.string().trim().max(200, "La description est trop longue.").nullable().optional(),
  notes: optText(1000),
  channel: z.enum(CHANNEL_IDS).nullable().optional(),
  clientRequestId: z.string().uuid().optional(),
});
export type ExpenseInput = z.infer<typeof expenseInputSchema>;

const incomeDetailFields = {
  kind: z.enum(INCOME_KIND_IDS, { message: "Type de revenu inconnu." }).optional(),
  status: z.enum(INCOME_STATUS_IDS, { message: "Statut inconnu." }).optional(),
  frequency: z.enum(FREQUENCY_IDS).optional(),
  expectedDate: isoDate.nullable().optional(),
  grossCents: amount(false).nullable().optional(),
  employeeContributionsCents: amount(false).nullable().optional(),
  otherDeductionsCents: amount(false).nullable().optional(),
  withholdingCents: amount(false).nullable().optional(),
  organization: optText(80),
  benefitType: optText(80),
  estimatedCents: amount(false).nullable().optional(),
  confirmedCents: amount(false).nullable().optional(),
  paidTo: z.enum(["user", "third_party"]).optional(),
  thirdPartyName: optText(80),
  notes: optText(500),
};

export const incomeCreateSchema = z.object({
  month: monthKey,
  source: z.enum(["alternance", "freelance", "other"]).optional(),
  label: text(60, "Le nom du revenu"),
  /** Montant réellement reçu (ou prévu tant que le statut n'est pas « confirmé »). Déduit du net/brut si omis. */
  amountCents: amount(false).optional(),
  receivedOn: isoDate.nullable().optional(),
  ...incomeDetailFields,
});

export const incomeUpdateSchema = z.object({
  label: text(60, "Le nom du revenu").optional(),
  amountCents: amount(false).optional(),
  receivedOn: isoDate.nullable().optional(),
  ...incomeDetailFields,
});

export const applyDefaultsSchema = z.object({ status: z.enum(["expected", "confirmed"]).default("expected") });

export const savingsSchema = z.object({ amountCents: amount(false) });

export const settingsUpdateSchema = z.object({
  defaultAlternanceCents: amount(false).optional(),
  defaultFreelanceCents: amount(false).optional(),
  theme: z.enum(["light", "dark", "system"]).optional(),
  timezone: z.string().refine(isValidTimeZone, "Fuseau horaire inconnu.").optional(),
  safetyReserveCents: amount(false).optional(),
  monthlySavingsTargetCents: amount(false).optional(),
  openingBalanceCents: z.number().int().min(-MAX_AMOUNT_CENTS).max(MAX_AMOUNT_CENTS).nullable().optional(),
  openingBalanceMonth: monthKey.nullable().optional(),
  aiShareDetail: z.boolean().optional(),
  alertPrefs: z
    .object({
      disabledKinds: z.array(z.enum(ALERT_KINDS)).max(ALERT_KINDS.length),
      minLevel: z.enum(ALERT_LEVELS as [string, ...string[]]),
      budgetWarnAt: z.number().min(0.5).max(0.95),
    })
    .optional(),
});

const email = z.string().trim().toLowerCase().email("Adresse e-mail invalide.").max(254);
const password = z
  .string()
  .min(8, "Le mot de passe doit contenir au moins 8 caractères.")
  .max(128, "Le mot de passe est trop long.");

export const registerSchema = z.object({ name: text(60, "Le prénom"), email, password });
export const loginSchema = z.object({ email, password: z.string().min(1, "Mot de passe requis.").max(128) });
export const passwordChangeSchema = z.object({ currentPassword: z.string().min(1).max(128), newPassword: password });
export const profileSchema = z.object({ name: text(60, "Le prénom"), email });

export const paymentMethodCreateSchema = z.object({ name: text(40, "Le nom") });
export const paymentMethodUpdateSchema = z.object({
  name: text(40, "Le nom").optional(),
  archived: z.boolean().optional(),
});

export const deleteDataSchema = z.object({
  confirm: z.literal("SUPPRIMER", { errorMap: () => ({ message: "Tapez SUPPRIMER pour confirmer." }) }),
  /** finance (défaut, comportement V1 étendu) | tasks | assistant | all */
  scope: z.enum(["finance", "tasks", "assistant", "all"]).default("finance"),
});


// --- V2 : marchands, taxonomie -----------------------------------------------------------------------
export const merchantCreateSchema = z.object({
  label: text(60, "Le nom de l'établissement"),
  categoryId: z.enum(CATEGORY_IDS).nullable().optional(),
  subcategoryId: z.string().max(64).nullable().optional(),
});

export const merchantPrefSchema = z
  .object({
    halalStatus: z.enum(["unknown", "claimed", "verified"]),
    halalSource: optText(200),
  })
  .refine((v) => v.halalStatus !== "verified" || (v.halalSource && v.halalSource.length > 0), {
    message: "Indiquez la source de la vérification (certificat, site officiel, note…).",
    path: ["halalSource"],
  });

export const subcategoryCreateSchema = z.object({
  categoryId: z.enum(CATEGORY_IDS),
  label: text(40, "Le nom"),
});

// --- V2 : budgets, charges fixes, épargne -------------------------------------------------------------
export const budgetUpsertSchema = z.object({
  month: monthKey,
  categoryId: z.enum(CATEGORY_IDS),
  limitCents: amount(true),
});
export const budgetCopySchema = z.object({ fromMonth: monthKey, toMonth: monthKey });

export const recurringItemSchema = z.object({
  label: text(60, "Le libellé"),
  amountCents: amount(true),
  frequency: z.enum(["weekly", "monthly", "quarterly", "yearly"]),
  nextDueDate: isoDate,
  endDate: isoDate.nullable().optional(),
  categoryId: z.enum(CATEGORY_IDS),
  subcategoryId: z.string().max(64).nullable().optional(),
  paymentMethodId: z.string().max(64).nullable().optional(),
  active: z.boolean().optional(),
  notes: optText(300),
});
export const recurringItemUpdateSchema = recurringItemSchema.partial();
/** `dueDate` désigne l'échéance réglée : protège d'un double clic qui paierait deux échéances. */
export const markPaidSchema = z.object({ paidOn: isoDate.optional(), amountCents: amount(true).optional(), dueDate: isoDate.optional() });

export const goalSchema = z.object({
  name: text(60, "Le nom de l'objectif"),
  targetCents: amount(true),
  deadline: isoDate.nullable().optional(),
  monthlyTargetCents: amount(false).nullable().optional(),
  isReserve: z.boolean().optional(),
  notes: optText(300),
});
export const goalUpdateSchema = goalSchema.partial().extend({ archived: z.boolean().optional() });
export const contributionSchema = z.object({
  amountCents: z.number({ invalid_type_error: "Montant invalide." }).int("Montant invalide.").refine((n) => n !== 0, "Le montant ne peut pas être nul.").refine((n) => Math.abs(n) <= MAX_AMOUNT_CENTS, "Montant trop élevé."),
  contributedOn: isoDate,
  note: optText(200),
});

// --- V2 : abonnements --------------------------------------------------------------------------------------
export const subscriptionSchema = z.object({
  name: text(60, "Le nom"),
  family: z.enum(SUBSCRIPTION_FAMILY_IDS),
  categoryId: z.enum(CATEGORY_IDS).optional(),
  subcategoryId: z.string().max(64).nullable().optional(),
  amountCents: amount(true),
  frequency: z.enum(["weekly", "monthly", "quarterly", "yearly"]),
  startDate: isoDate.nullable().optional(),
  renewalDate: isoDate.nullable().optional(),
  paymentMethodId: z.string().max(64).nullable().optional(),
  status: z.enum(SUBSCRIPTION_STATUS_IDS).optional(),
  cancelledOn: isoDate.nullable().optional(),
  cancelNoticeDays: z.number().int().min(0).max(365).nullable().optional(),
  cancelUrl: z.string().trim().url("Lien invalide.").max(300).refine((u) => /^https?:\/\//i.test(u), "Le lien doit commencer par http(s)://").nullable().optional(),
  cancelNotes: optText(500),
  notes: optText(500),
});
export const subscriptionUpdateSchema = subscriptionSchema.partial();

// --- V2 : tâches ---------------------------------------------------------------------------------------------
const dueTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Heure invalide.");
export const taskSchema = z
  .object({
    title: text(160, "Le titre"),
    description: optText(2000),
    priority: z.enum(PRIORITY_IDS).optional(),
    status: z.enum(TASK_STATUS_IDS).optional(),
    dueDate: isoDate.nullable().optional(),
    dueTime: dueTime.nullable().optional(),
    estimatedMinutes: z.number().int().min(1).max(1440).nullable().optional(),
    categoryId: z.string().max(64).nullable().optional(),
    recurrence: z.enum(RECURRENCE_IDS).optional(),
  })
  .refine((t) => !t.dueTime || !!t.dueDate, { message: "Indiquez une date pour fixer une heure.", path: ["dueTime"] });
export const taskUpdateSchema = z.object({
  title: text(160, "Le titre").optional(),
  description: optText(2000),
  priority: z.enum(PRIORITY_IDS).optional(),
  status: z.enum(TASK_STATUS_IDS).optional(),
  dueDate: isoDate.nullable().optional(),
  dueTime: dueTime.nullable().optional(),
  estimatedMinutes: z.number().int().min(1).max(1440).nullable().optional(),
  categoryId: z.string().max(64).nullable().optional(),
  recurrence: z.enum(RECURRENCE_IDS).optional(),
});
export const taskCategorySchema = z.object({
  name: text(30, "Le nom"),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Couleur invalide.").optional(),
});

// --- V2 : notifications et assistant IA ---------------------------------------------------------------------
export const notificationActionSchema = z.object({ action: z.enum(["read", "dismiss"]) });
export const aiChatSchema = z.object({ message: z.string().trim().min(1, "Écrivez votre question.").max(2000, "Message trop long (2000 caractères max).") });
