import { useMutation, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { api, ApiRequestError, errorMessage } from "./api";
import { useToast } from "../hooks/Toast";
import type {
  AiMessageDTO, AiStatusDTO, AnalysisMonthDTO, BudgetRowDTO, ExpenseEntryDTO, ForecastDTO, GoalDTO, MeDTO, MonthSummaryDTO,
  NotificationDTO, OverviewDTO, RecurringItemDTO, SubscriptionsOverviewDTO, TaskDTO, TasksOverviewDTO, TaxonomyDTO,
} from "../../shared/types";
import type { Recommendation } from "../../shared/recommendations";
import type { BreakdownRow, Comparison, SeriesPoint, TxLine, Unusual } from "../../shared/analytics";

export const qk = {
  me: ["me"] as const,
  month: (m: string) => ["month", m] as const,
  expenses: (m: string) => ["expenses", m] as const,
  expense: (id: string) => ["expense", id] as const,
  analysis: (end: string, count: number) => ["analysis", end, count] as const,
};

export function useMe() {
  return useQuery({
    queryKey: qk.me,
    queryFn: async () => {
      try {
        return await api<MeDTO>("/auth/me");
      } catch (e) {
        if (e instanceof ApiRequestError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 5 * 60_000,
  });
}

/** Utilisateur connecté (à n'utiliser que sous la garde d'authentification). */
export function useSession(): MeDTO {
  const { data } = useMe();
  if (!data) throw new Error("useSession hors session");
  return data;
}

export function useMonthSummary(month: string) {
  return useQuery({ queryKey: qk.month(month), queryFn: () => api<MonthSummaryDTO>(`/months/${month}`) });
}

export function useExpenses(month: string) {
  return useQuery({ queryKey: qk.expenses(month), queryFn: () => api<ExpenseEntryDTO[]>(`/expenses?month=${month}`) });
}

export function useAnalysis(end: string, count: number) {
  return useQuery({
    queryKey: qk.analysis(end, count),
    queryFn: () => api<AnalysisMonthDTO[]>(`/analysis?end=${end}&count=${count}`),
  });
}

/** Les données financières et dérivées (aperçu, budgets, analyses, alertes…) à recalculer après une écriture. */
const FINANCE_KEYS = ["month", "expenses", "expense", "analysis", "overview", "budgets", "recurring", "subscriptions", "goals", "forecast", "analytics", "notifications", "ai-reco"];

export function useRefreshFinance() {
  const qc = useQueryClient();
  return (summary?: MonthSummaryDTO) => {
    if (summary) qc.setQueryData(qk.month(summary.month), summary);
    return Promise.all(FINANCE_KEYS.map((k) => qc.invalidateQueries({ queryKey: [k] })));
  };
}

/** Mutation avec message d'erreur lisible et rafraîchissement des données financières. */
export function useAction<TVars, TOut = unknown>(fn: (v: TVars) => Promise<TOut>, opts: { success?: string; keys?: string[]; onDone?: (out: TOut) => void } = {}) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: fn,
    onSuccess: async (out) => {
      await Promise.all((opts.keys ?? FINANCE_KEYS).map((k) => qc.invalidateQueries({ queryKey: [k] })));
      if (opts.success) toast(opts.success);
      opts.onDone?.(out);
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });
}

const q = <T,>(key: QueryKey, path: string, extra: { enabled?: boolean; staleTime?: number } = {}) =>
  useQuery({ queryKey: key, queryFn: () => api<T>(path), ...extra });

export const useOverview = (month?: string) => q<OverviewDTO>(["overview", month ?? "current"], month ? `/overview?month=${month}` : "/overview");
export const useTaxonomy = () => q<TaxonomyDTO>(["taxonomy"], "/taxonomy", { staleTime: 5 * 60_000 });
export const useSubscriptions = () => q<SubscriptionsOverviewDTO>(["subscriptions"], "/subscriptions");
export const useBudgets = (month: string) => q<{ month: string; rows: BudgetRowDTO[] }>(["budgets", month], `/budgets?month=${month}`);
export const useRecurring = () => q<RecurringItemDTO[]>(["recurring"], "/recurring");
export const useGoals = () => q<{ goals: GoalDTO[]; reservesCents: number }>(["goals"], "/goals");
export const useForecast = (count = 6) => q<ForecastDTO>(["forecast", count], `/forecast?count=${count}`);
export const useTasks = () => q<TasksOverviewDTO>(["tasks"], "/tasks");
export const useNotifications = () => q<NotificationDTO[]>(["notifications"], "/notifications");
export const useAiStatus = () => q<AiStatusDTO>(["ai-status"], "/ai/status", { staleTime: 5 * 60_000 });
export const useAiMessages = () => q<AiMessageDTO[]>(["ai-messages"], "/ai/messages");
export const useRecommendations = () => q<{ recommendations: Recommendation[] }>(["ai-reco"], "/ai/recommendations");

export interface AnalyticsOverview {
  range: { granularity: string; from: string; to: string; previous: { from: string; to: string } };
  series: SeriesPoint[];
  comparison: Comparison;
  categories: { totalCents: number; rows: BreakdownRow[] };
  unusual: Unusual[];
}
export interface BreakdownResult { from: string; to: string; by: string; totalCents: number; rows: BreakdownRow[] }
export interface TransactionsResult { from: string; to: string; totalCents: number; count: number; lines: TxLine[] }

export const useAnalyticsOverview = (qs: string) => q<AnalyticsOverview>(["analytics", "overview", qs], `/analytics/overview?${qs}`);
export const useBreakdown = (qs: string) => q<BreakdownResult>(["analytics", "breakdown", qs], `/analytics/breakdown?${qs}`);
export const useTransactions = (qs: string, enabled: boolean) => q<TransactionsResult>(["analytics", "tx", qs], `/analytics/transactions?${qs}`, { enabled });

export type { TaskDTO };
