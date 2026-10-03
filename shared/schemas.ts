import { z } from "zod";
import { CATEGORY_IDS } from "./categories";
import { MAX_AMOUNT_CENTS } from "./money";
import { isMonthKey, isValidISODate } from "./month";

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

export const expenseInputSchema = z.object({
  date: isoDate,
  location: locationSchema,
  amounts: z
    .array(z.object({ categoryId: z.enum(CATEGORY_IDS, { message: "Catégorie inconnue." }), amountCents: amount(true) }))
    .min(1, "Ajoutez au moins une catégorie avec un montant.")
    .max(CATEGORY_IDS.length)
    .refine((a) => new Set(a.map((x) => x.categoryId)).size === a.length, "Une catégorie apparaît deux fois."),
  /** null = « Autre » moyen de paiement */
  paymentMethodId: z.string().max(64).nullable(),
  description: z.string().trim().max(200, "La description est trop longue.").nullable().optional(),
  clientRequestId: z.string().uuid().optional(),
});
export type ExpenseInput = z.infer<typeof expenseInputSchema>;

export const incomeCreateSchema = z.object({
  month: monthKey,
  source: z.enum(["alternance", "freelance", "other"]),
  label: text(60, "Le nom du revenu"),
  amountCents: amount(false),
  receivedOn: isoDate.nullable().optional(),
});

export const incomeUpdateSchema = z.object({
  label: text(60, "Le nom du revenu").optional(),
  amountCents: amount(false).optional(),
  receivedOn: isoDate.nullable().optional(),
});

export const savingsSchema = z.object({ amountCents: amount(false) });

export const settingsUpdateSchema = z.object({
  defaultAlternanceCents: amount(false).optional(),
  defaultFreelanceCents: amount(false).optional(),
  theme: z.enum(["light", "dark", "system"]).optional(),
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

export const deleteDataSchema = z.object({ confirm: z.literal("SUPPRIMER", { errorMap: () => ({ message: "Tapez SUPPRIMER pour confirmer." }) }) });
