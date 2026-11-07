import { z } from "zod";
import type { Env } from "../env";
import { ApiError } from "./http";
import { formatEUR } from "../../shared/money";
import { getCategory } from "../../shared/categories";
import type { AiProposalDTO } from "../../shared/types";
import type { Snapshot } from "./insights";

export interface AiConfig {
  provider: "anthropic" | "openai" | "openai-compatible";
  apiKey: string;
  model: string;
  baseUrl: string;
}

/** null = non configuré. Aucune réponse n'est jamais simulée : sans configuration complète, le chat est désactivé. */
export function aiConfig(env: Env): AiConfig | null {
  const provider = env.AI_PROVIDER;
  if (provider !== "anthropic" && provider !== "openai" && provider !== "openai-compatible") return null;
  if (!env.AI_API_KEY || !env.AI_MODEL) return null;
  const baseUrl =
    env.AI_BASE_URL?.replace(/\/+$/, "") ?? (provider === "anthropic" ? "https://api.anthropic.com" : provider === "openai" ? "https://api.openai.com/v1" : "");
  if (!baseUrl) return null;
  if (!/^https:\/\//i.test(baseUrl) && !/^http:\/\/(localhost|127\.0\.0\.1)/i.test(baseUrl)) return null;
  return { provider, apiKey: env.AI_API_KEY, model: env.AI_MODEL, baseUrl };
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

const SYSTEM_PROMPT = `Tu es l'assistant d'O-Budget, une application personnelle de finances et d'organisation. Tu réponds en français, de façon concise et concrète.

RÈGLES STRICTES
- Tu n'utilises QUE les données du bloc DONNEES ci-dessous. Si une information manque, dis-le : n'invente jamais un montant, une date ou une tâche.
- Les calculs (montant journalier conseillé, solde projeté, totaux, taux d'épargne) sont déjà faits de façon déterministe : recopie-les, ne les recalcule pas et ne les contredis pas.
- Les revenus « attendus » ne sont pas de l'argent disponible.
- Tu ne modifies rien toi-même. Pour suggérer une organisation de tâches, ajoute À LA FIN un bloc \`\`\`proposals contenant un tableau JSON d'objets {"title","dueDate","dueTime","priority","estimatedMinutes","reason"} (dueDate au format AAAA-MM-JJ ou null ; priority = urgent|important|normal). L'utilisateur choisira d'appliquer ou non chaque proposition.
- Tu n'es ni conseiller financier ni juriste : pour une décision importante, rappelle-le brièvement.`;

/** Contexte envoyé au modèle : agrégats uniquement (pas d'e-mail, pas de nom, pas de transaction individuelle). */
export function buildContext(snap: Snapshot, opts: { shareDetail: boolean; topMerchants?: { label: string; amountCents: number }[] }) {
  const p = snap.facts.position;
  const s = snap.facts.summary;
  const e = (c: number) => formatEUR(c);
  const data = {
    date_du_jour: snap.today,
    mois: snap.month,
    jours_restants_dans_le_mois: p.remainingDays,
    revenus_recus: e(p.receivedIncomeCents),
    revenus_attendus_non_recus: e(p.expectedIncomeCents),
    depenses_du_mois: e(s.totals.expenseCents),
    epargne_deja_faite: e(s.savingsCents),
    objectif_epargne_mensuel: e(snap.settings.monthlySavingsTargetCents),
    echeances_a_venir_ce_mois: e(p.obligationsDueCents),
    reserve_de_securite: e(p.safetyReserveCents),
    fonds_disponibles: e(p.availableFundsCents),
    marge_discretionnaire: e(p.discretionaryCents),
    depense_journaliere_conseillee: e(p.dailyAllowanceCents),
    solde_projete_fin_de_mois_prudent: e(p.projectedEndCashCents),
    categories: s.categories.filter((c) => c.amountCents > 0).slice(0, 8).map((c) => ({ categorie: getCategory(c.categoryId).label, montant: e(c.amountCents), part: `${c.percent.toFixed(0)} %` })),
    budgets: snap.budgets.map((b) => ({ categorie: getCategory(b.categoryId).label, depense: e(b.status.spentCents), limite: e(b.status.limitCents), etat: b.status.state })),
    taches_ouvertes: snap.tasks.length,
    taches_en_retard: snap.alertInput.tasks.filter((t) => t.dueDate && t.dueDate < snap.today).length,
    ...(opts.shareDetail && opts.topMerchants ? { principaux_etablissements_du_mois: opts.topMerchants.map((m) => ({ nom: m.label, montant: e(m.amountCents) })) } : {}),
  };
  return `DONNEES\n${JSON.stringify(data, null, 1)}`;
}

export function systemPrompt(context: string) {
  return `${SYSTEM_PROMPT}\n\n${context}`;
}

const proposalSchema = z.array(
  z.object({
    title: z.string().trim().min(1).max(160),
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
    dueTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().default(null),
    priority: z.enum(["urgent", "important", "normal"]).default("normal"),
    estimatedMinutes: z.number().int().min(1).max(1440).nullable().default(null),
    reason: z.string().trim().max(300).default(""),
  }),
);

/** Sépare le texte de la réponse et les éventuelles propositions de tâches (validées ; un bloc invalide est ignoré). */
export function extractProposals(raw: string): { text: string; proposals: AiProposalDTO[] } {
  const m = raw.match(/```proposals\s*([\s\S]*?)```/i);
  if (!m) return { text: raw.trim(), proposals: [] };
  const text = raw.replace(m[0], "").trim();
  try {
    const parsed = proposalSchema.safeParse(JSON.parse(m[1]));
    if (!parsed.success) return { text, proposals: [] };
    return { text, proposals: parsed.data.slice(0, 8).map((p) => ({ type: "task" as const, ...p })) };
  } catch {
    return { text, proposals: [] };
  }
}

export async function callModel(cfg: AiConfig, system: string, turns: ChatTurn[]): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);
  try {
    let res: Response;
    if (cfg.provider === "anthropic") {
      res = await fetch(`${cfg.baseUrl}/v1/messages`, {
        method: "POST",
        signal: controller.signal,
        headers: { "content-type": "application/json", "x-api-key": cfg.apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: cfg.model, max_tokens: 1200, system, messages: turns }),
      });
    } else {
      res = await fetch(`${cfg.baseUrl}/chat/completions`, {
        method: "POST",
        signal: controller.signal,
        headers: { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}` },
        body: JSON.stringify({ model: cfg.model, messages: [{ role: "system", content: system }, ...turns] }),
      });
    }
    if (!res.ok) {
      // On journalise le statut, jamais le corps (il pourrait contenir des données de la requête).
      console.error("[o-budget] fournisseur IA", cfg.provider, res.status);
      throw new ApiError(502, "Le fournisseur IA a refusé la requête. Vérifiez AI_API_KEY et AI_MODEL.");
    }
    const json = (await res.json()) as {
      content?: { type: string; text?: string }[];
      choices?: { message?: { content?: string } }[];
    };
    const text =
      cfg.provider === "anthropic"
        ? (json.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("\n")
        : (json.choices?.[0]?.message?.content ?? "");
    if (!text.trim()) throw new ApiError(502, "Le fournisseur IA n'a renvoyé aucune réponse.");
    return text;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    console.error("[o-budget] appel IA échoué", e instanceof Error ? e.name : "erreur");
    throw new ApiError(502, "Impossible de joindre le fournisseur IA. Réessayez.");
  } finally {
    clearTimeout(timer);
  }
}
