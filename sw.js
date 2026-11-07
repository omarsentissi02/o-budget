// O-Budget V2 — service worker.
// CONFIDENTIALITÉ : aucune donnée financière n'est jamais mise en cache.
//  - /api/* : toujours le réseau, jamais le cache (un autre utilisateur sur le même appareil ne peut rien relire).
//  - Seuls les fichiers de l'application (HTML, JS, CSS, icônes) sont mis en cache, pour un démarrage rapide.
//  - Hors ligne : l'application s'ouvre mais affiche « vous êtes hors ligne » ; aucune donnée périmée n'est servie.
const VERSION = "v2";
const SHELL = `ob-shell-${VERSION}`;
const SHELL_FILES = ["/", "/manifest.webmanifest", "/icons/icon.svg", "/icons/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      // Supprime les anciens caches de l'application ET l'ancien cache de données de la V1 (« ob-api »).
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "purge") event.waitUntil(caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))));
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return; // réseau uniquement (comportement par défaut du navigateur)

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(SHELL).then((c) => c.put("/", copy));
          }
          return res;
        })
        .catch(() => caches.match("/")),
    );
    return;
  }

  if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(SHELL).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
  }
});
