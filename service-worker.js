// Service worker — Poznávačka (carnet de voyage Slovaquie)
// Placé à la racine du déploiement (à côté de index.html, html/, src/,
// img/) pour que son scope naturel couvre tout le site sans avoir
// besoin d'un en-tête Service-Worker-Allowed côté serveur.
//
// Stratégie : precache du "noyau" (shell) à l'install, puis cache-first +
// mise à jour en arrière-plan pour tout le reste (fiches d'étape, lieux,
// images...) au fil de la navigation. Pas besoin de lister ici les
// dizaines de fiches générées par tmd2html.py : tout ce que tu visites
// une fois reste ensuite disponible hors-ligne.

const CACHE_VERSION = "slovakia-v4";
// Le scope est déduit de l'emplacement du service worker : le site peut donc
// vivre sous n'importe quel préfixe (/slovakia/, /TravelBook-Slovakia/, racine...).
const SCOPE = new URL("./", self.location).pathname;

// Fichiers indispensables au démarrage de l'app — noms réels d'après
// l'archive du 12/09/2026 (racine + html/ + src/).
const CORE_ASSETS = [
  SCOPE,
  SCOPE + "index.html",              // redirection racine -> html/index.html
  SCOPE + "html/index.html",
  SCOPE + "html/carnet.html",
  SCOPE + "html/bibliotheque.html",
  SCOPE + "html/brouillon.html",
  SCOPE + "html/agenda.html",
  SCOPE + "html/pratique.html",
  SCOPE + "html/pays.html",
  SCOPE + "src/style.css",
  SCOPE + "src/app.js",
  SCOPE + "src/agenda.js",
  SCOPE + "src/swipe.js",
  SCOPE + "manifest.json",
  SCOPE + "icons/icon-192.png",
  SCOPE + "icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) =>
      cache.addAll(CORE_ASSETS).catch((err) => {
        // Si un des fichiers listés n'existe pas encore / a un autre nom,
        // on log l'erreur mais on ne bloque pas l'installation du SW.
        console.warn("[SW] precache partiel :", err);
      })
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_VERSION)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // On ne gère que le GET, même origine, et uniquement sous le scope du site
  if (req.method !== "GET" || !req.url.startsWith(self.location.origin)) {
    return;
  }
  if (!new URL(req.url).pathname.startsWith(SCOPE)) {
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          // On met à jour le cache silencieusement à chaque visite en ligne
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => cached); // hors-ligne : on retombe sur le cache

      // cache-first : réponse immédiate si on l'a déjà, sinon on attend le réseau
      return cached || network;
    })
  );
});
