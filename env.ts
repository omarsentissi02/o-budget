export interface Env {
  DB: D1Database;
  /** "false" ferme les inscriptions (recommandé une fois votre compte créé). */
  ALLOW_SIGNUP?: string;
  /**
   * Assistant IA — TOUT est côté serveur, rien n'est exposé au navigateur.
   * AI_PROVIDER : "anthropic" | "openai" | "openai-compatible". Sans AI_API_KEY, l'assistant conversationnel est désactivé
   * (les recommandations déterministes restent disponibles : elles n'utilisent aucun modèle).
   */
  AI_PROVIDER?: string;
  /** Secret : `wrangler secret put AI_API_KEY` (jamais dans wrangler.jsonc ni dans le dépôt). */
  AI_API_KEY?: string;
  AI_MODEL?: string;
  /** Obligatoire pour "openai-compatible" ; facultatif sinon (ex. https://api.openai.com/v1). */
  AI_BASE_URL?: string;
}

export interface AppEnv {
  Bindings: Env;
  Variables: { userId: string };
}
