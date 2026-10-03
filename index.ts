import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import type { AppEnv } from "./env";
import { ApiError } from "./lib/http";
import { requireAuth, sameOrigin } from "./lib/session";
import { auth } from "./routes/auth";
import { settings } from "./routes/settings";
import { months } from "./routes/months";
import { expenses } from "./routes/expenses";
import { exportRoutes } from "./routes/export";

const app = new Hono<AppEnv>().basePath("/api");

app.use("*", secureHeaders());
app.use("*", sameOrigin);
app.use("*", async (c, next) => {
  await next();
  // Données financières privées : jamais de cache partagé.
  if (!c.res.headers.has("Cache-Control")) c.res.headers.set("Cache-Control", "private, no-store");
});

app.route("/auth", auth);

// Tout ce qui n'est pas /api/auth/* exige une session valide.
app.use("*", (c, next) => (c.req.path.startsWith("/api/auth/") ? next() : requireAuth(c, next)));
app.route("/", settings);
app.route("/", months);
app.route("/", expenses);
app.route("/", exportRoutes);

app.notFound((c) => c.json({ error: "Ressource introuvable." }, 404));

app.onError((err, c) => {
  if (err instanceof ApiError) return c.json({ error: err.message }, err.status);
  console.error("[o-budget] erreur serveur", c.req.method, c.req.path, err);
  return c.json({ error: "Une erreur est survenue. Réessayez." }, 500);
});

export default app;
