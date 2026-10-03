export interface Env {
  DB: D1Database;
  /** "false" ferme les inscriptions (recommandé une fois votre compte créé). */
  ALLOW_SIGNUP?: string;
}

export interface AppEnv {
  Bindings: Env;
  Variables: { userId: string };
}
