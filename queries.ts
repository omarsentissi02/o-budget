import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiRequestError } from "./api";
import type { AnalysisMonthDTO, ExpenseEntryDTO, MeDTO, MonthSummaryDTO } from "../../shared/types";

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

/** Après toute écriture financière : les totaux, listes et analyses se recalculent. */
export function useRefreshFinance() {
  const qc = useQueryClient();
  return (summary?: MonthSummaryDTO) => {
    if (summary) qc.setQueryData(qk.month(summary.month), summary);
    return Promise.all([
      qc.invalidateQueries({ queryKey: ["month"] }),
      qc.invalidateQueries({ queryKey: ["expenses"] }),
      qc.invalidateQueries({ queryKey: ["expense"] }),
      qc.invalidateQueries({ queryKey: ["analysis"] }),
    ]);
  };
}
