import { useEffect } from "react";
import type { Theme } from "../../shared/types";

export function applyTheme(theme: Theme) {
  const dark = theme === "dark" || (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  try {
    localStorage.setItem("ob:theme", theme);
  } catch {
    /* stockage indisponible : sans conséquence */
  }
}

export function useApplyTheme(theme: Theme | undefined) {
  useEffect(() => {
    if (!theme) return;
    applyTheme(theme);
    if (theme !== "system") return;
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);
}
