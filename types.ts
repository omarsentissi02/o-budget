import type { CategoryId } from "./categories";
import type { CategoryTotal, MonthTotals } from "./finance";

export type Theme = "light" | "dark" | "system";
export type IncomeSource = "alternance" | "freelance" | "other";

export interface UserDTO {
  id: string;
  email: string;
  name: string;
}

export interface SettingsDTO {
  defaultAlternanceCents: number;
  defaultFreelanceCents: number;
  currency: "EUR";
  theme: Theme;
}

export interface PaymentMethodDTO {
  id: string;
  name: string;
  archived: boolean;
}

export interface MeDTO {
  user: UserDTO;
  settings: SettingsDTO;
  paymentMethods: PaymentMethodDTO[];
}

export interface IncomeDTO {
  id: string;
  source: IncomeSource;
  label: string;
  amountCents: number;
  receivedOn: string | null;
}

export interface MonthSummaryDTO {
  month: string;
  incomes: IncomeDTO[];
  savingsCents: number;
  totals: MonthTotals;
  categories: CategoryTotal[];
}

export type LocationDTO =
  | { type: "france"; city: string }
  | { type: "abroad"; countryCode: string | null; countryName: string };

export interface ExpenseAmountDTO {
  categoryId: CategoryId;
  amountCents: number;
}

export interface ExpenseEntryDTO {
  id: string;
  date: string;
  location: LocationDTO;
  paymentMethodId: string | null;
  paymentLabel: string;
  description: string | null;
  amounts: ExpenseAmountDTO[];
  totalCents: number;
}

export interface AnalysisMonthDTO extends MonthTotals {
  month: string;
}

export function locationLabel(loc: LocationDTO): string {
  return loc.type === "france" ? `${loc.city}, France` : loc.countryName;
}
