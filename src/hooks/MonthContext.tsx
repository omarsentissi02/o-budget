import { createContext, useContext, useState, type ReactNode } from "react";
import { currentMonthKey, isMonthKey } from "../../shared/month";

interface MonthCtx {
  month: string;
  setMonth: (m: string) => void;
}

const Ctx = createContext<MonthCtx | null>(null);

export function MonthProvider({ children }: { children: ReactNode }) {
  const [month, setMonthState] = useState(() => {
    const saved = sessionStorage.getItem("ob:month");
    return saved && isMonthKey(saved) ? saved : currentMonthKey();
  });
  const setMonth = (m: string) => {
    sessionStorage.setItem("ob:month", m);
    setMonthState(m);
  };
  return <Ctx.Provider value={{ month, setMonth }}>{children}</Ctx.Provider>;
}

export function useSelectedMonth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("MonthProvider manquant");
  return ctx;
}
