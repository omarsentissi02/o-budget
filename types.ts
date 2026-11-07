import type { CategoryId } from "./categories";
import type { CategoryTotal, MonthTotals } from "./finance";
import type { CashState, Frequency, IncomeKind, IncomeStatus, IncomeTotals, PaidTo } from "./income";
import type { MonthPosition, BudgetStatus, ForecastMonth } from "./budget";
import type { AlertLevel, AlertPrefs } from "./alerts";
import type { HalalStatus, MerchantView } from "./merchants";
import type { SubscriptionCosts, SubscriptionFamily, SubscriptionStatus } from "./subscriptions";
import type { Priority, Recurrence, TaskStatus, DayLoad } from "./tasks";
import type { Unusual } from "./analytics";

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
  timezone: string;
  safetyReserveCents: number;
  monthlySavingsTargetCents: number;
  openingBalanceCents: number | null;
  openingBalanceMonth: string | null;
  aiShareDetail: boolean;
  alertPrefs: AlertPrefs;
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
  /** Montant reçu (si confirmé) ou prévu (sinon). */
  amountCents: number;
  receivedOn: string | null;
  // --- V2 (valeurs par défaut pour les revenus V1 : confirmé, versé à l'utilisateur) ---
  kind: IncomeKind;
  status: IncomeStatus;
  cashState: CashState;
  frequency: Frequency;
  expectedDate: string | null;
  grossCents: number | null;
  employeeContributionsCents: number | null;
  otherDeductionsCents: number | null;
  withholdingCents: number | null;
  /** Net calculé (brut − retenues) quand le brut est renseigné. */
  netCents: number | null;
  organization: string | null;
  benefitType: string | null;
  estimatedCents: number | null;
  confirmedCents: number | null;
  paidTo: PaidTo;
  thirdPartyName: string | null;
  notes: string | null;
}

export interface MonthSummaryDTO {
  month: string;
  incomes: IncomeDTO[];
  savingsCents: number;
  /** `incomeCents` = revenus REÇUS uniquement. */
  totals: MonthTotals;
  /** Détail reçu / attendu / indirect / exclu. */
  income: IncomeTotals;
  categories: CategoryTotal[];
}

export type LocationDTO =
  | { type: "france"; city: string }
  | { type: "abroad"; countryCode: string | null; countryName: string };

export interface ExpenseAmountDTO {
  categoryId: CategoryId;
  amountCents: number;
  subcategoryId: string | null;
  subcategoryLabel: string | null;
  merchantId: string | null;
  merchantLabel: string | null;
  platformId: string | null;
  tripFrom: string | null;
  tripTo: string | null;
  tripDate: string | null;
  note: string | null;
}

export interface ExpenseEntryDTO {
  id: string;
  date: string;
  location: LocationDTO;
  paymentMethodId: string | null;
  paymentLabel: string;
  description: string | null;
  notes: string | null;
  channel: string | null;
  amounts: ExpenseAmountDTO[];
  totalCents: number;
}

export interface AnalysisMonthDTO extends MonthTotals {
  month: string;
}

export function locationLabel(loc: LocationDTO): string {
  return loc.type === "france" ? `${loc.city}, France` : loc.countryName;
}


// --- V2 ----------------------------------------------------------------------------------------------------
export interface SubcategoryDTO {
  id: string;
  categoryId: CategoryId;
  label: string;
  system: boolean;
}

export interface TaxonomyDTO {
  customSubcategories: SubcategoryDTO[];
  merchants: MerchantView[];
}

export interface BudgetRowDTO {
  categoryId: CategoryId;
  limitCents: number | null;
  status: BudgetStatus;
}

export interface RecurringItemDTO {
  id: string;
  label: string;
  amountCents: number;
  frequency: Exclude<Frequency, "once">;
  nextDueDate: string;
  endDate: string | null;
  categoryId: CategoryId;
  subcategoryId: string | null;
  paymentMethodId: string | null;
  paymentLabel: string;
  active: boolean;
  lastPaidOn: string | null;
  notes: string | null;
}

export interface GoalDTO {
  id: string;
  name: string;
  targetCents: number;
  savedCents: number;
  deadline: string | null;
  monthlyTargetCents: number | null;
  isReserve: boolean;
  archived: boolean;
  notes: string | null;
  progress: number;
  /** Versement mensuel nécessaire pour atteindre l'objectif à l'échéance (null sans échéance ou déjà atteint). */
  requiredMonthlyCents: number | null;
}

export interface ContributionDTO {
  id: string;
  goalId: string;
  amountCents: number;
  contributedOn: string;
  note: string | null;
}

export interface SubscriptionDTO {
  id: string;
  name: string;
  family: SubscriptionFamily;
  categoryId: CategoryId;
  subcategoryId: string | null;
  amountCents: number;
  frequency: Exclude<Frequency, "once">;
  monthlyCents: number;
  yearlyCents: number;
  startDate: string | null;
  renewalDate: string | null;
  paymentMethodId: string | null;
  paymentLabel: string;
  status: SubscriptionStatus;
  cancelledOn: string | null;
  cancelNoticeDays: number | null;
  cancelUrl: string | null;
  cancelNotes: string | null;
  notes: string | null;
  lastPaidOn: string | null;
}

export interface SubscriptionsOverviewDTO {
  items: SubscriptionDTO[];
  costs: SubscriptionCosts;
  upcoming: (SubscriptionDTO & { inDays: number })[];
  duplicates: string[][];
}

export interface TaskDTO {
  id: string;
  title: string;
  description: string | null;
  priority: Priority;
  status: TaskStatus;
  dueDate: string | null;
  dueTime: string | null;
  estimatedMinutes: number | null;
  categoryId: string | null;
  recurrence: Recurrence;
  seriesId: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface TaskCategoryDTO {
  id: string;
  name: string;
  color: string;
}

export interface NotificationDTO {
  id: string;
  kind: string;
  level: AlertLevel;
  title: string;
  body: string;
  link: string | null;
  createdAt: string;
  readAt: string | null;
}

export interface UpcomingObligationDTO {
  id: string;
  label: string;
  amountCents: number;
  dueDate: string;
  kind: "subscription" | "recurring";
}

export interface OverviewDTO {
  month: string;
  today: string;
  position: MonthPosition;
  summary: MonthSummaryDTO;
  accountBalanceCents: number | null;
  obligations: UpcomingObligationDTO[];
  budgets: BudgetRowDTO[];
  insights: InsightDTO[];
  recent: ExpenseEntryDTO[];
  tasksToday: TaskDTO[];
  tasksOverdueCount: number;
  unreadNotifications: number;
}

export interface InsightDTO {
  level: AlertLevel;
  title: string;
  body: string;
  link: string;
}

export interface ForecastDTO {
  startingCashCents: number;
  months: ForecastMonth[];
  basis: { avgVariableSpendCents: number; plannedSavingsCents: number; incomeSources: number; obligationSources: number };
}

export interface TasksOverviewDTO {
  tasks: TaskDTO[];
  categories: TaskCategoryDTO[];
  loads: DayLoad[];
}

export interface AiStatusDTO {
  configured: boolean;
  provider: string | null;
  model: string | null;
}

export interface AiProposalDTO {
  type: "task";
  title: string;
  dueDate: string | null;
  dueTime: string | null;
  priority: Priority;
  estimatedMinutes: number | null;
  reason: string;
}

export interface AiMessageDTO {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  proposals?: AiProposalDTO[];
}

export interface UnusualDTO {
  items: Unusual[];
}

export type { HalalStatus };
