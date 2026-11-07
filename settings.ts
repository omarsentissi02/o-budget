import { DEFAULT_ALERT_PREFS, type AlertPrefs } from "../../shared/alerts";
import { DEFAULT_TIMEZONE, timeInZone, todayInZone } from "../../shared/month";
import type { SettingsDTO, Theme } from "../../shared/types";

export interface SettingsRow {
  default_alternance_cents: number;
  default_freelance_cents: number;
  theme: Theme;
  timezone: string;
  safety_reserve_cents: number;
  monthly_savings_target_cents: number;
  opening_balance_cents: number | null;
  opening_balance_month: string | null;
  alert_prefs: string;
  ai_share_detail: number;
}

export const SETTINGS_COLUMNS =
  "default_alternance_cents, default_freelance_cents, theme, timezone, safety_reserve_cents, monthly_savings_target_cents, opening_balance_cents, opening_balance_month, alert_prefs, ai_share_detail";

export function parseAlertPrefs(raw: string | null | undefined): AlertPrefs {
  try {
    const v = JSON.parse(raw || "{}") as Partial<AlertPrefs>;
    return {
      disabledKinds: Array.isArray(v.disabledKinds) ? v.disabledKinds : DEFAULT_ALERT_PREFS.disabledKinds,
      minLevel: v.minLevel ?? DEFAULT_ALERT_PREFS.minLevel,
      budgetWarnAt: typeof v.budgetWarnAt === "number" ? v.budgetWarnAt : DEFAULT_ALERT_PREFS.budgetWarnAt,
    };
  } catch {
    return DEFAULT_ALERT_PREFS;
  }
}

export function toSettingsDTO(s: SettingsRow | undefined): SettingsDTO {
  return {
    defaultAlternanceCents: s?.default_alternance_cents ?? 120200,
    defaultFreelanceCents: s?.default_freelance_cents ?? 50000,
    currency: "EUR",
    theme: s?.theme ?? "system",
    timezone: s?.timezone ?? DEFAULT_TIMEZONE,
    safetyReserveCents: s?.safety_reserve_cents ?? 0,
    monthlySavingsTargetCents: s?.monthly_savings_target_cents ?? 0,
    openingBalanceCents: s?.opening_balance_cents ?? null,
    openingBalanceMonth: s?.opening_balance_month ?? null,
    aiShareDetail: (s?.ai_share_detail ?? 0) === 1,
    alertPrefs: parseAlertPrefs(s?.alert_prefs),
  };
}

export async function loadSettings(db: D1Database, userId: string): Promise<SettingsDTO> {
  const row = await db.prepare(`SELECT ${SETTINGS_COLUMNS} FROM user_settings WHERE user_id = ?`).bind(userId).first<SettingsRow>();
  return toSettingsDTO(row ?? undefined);
}

/** « Aujourd'hui » et l'heure locale dans le fuseau de l'utilisateur (le Worker tourne en UTC). */
export function localNow(settings: Pick<SettingsDTO, "timezone">, now = new Date()) {
  return { today: todayInZone(settings.timezone, now), time: timeInZone(settings.timezone, now) };
}
