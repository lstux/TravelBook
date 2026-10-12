// Onglet Pratique — checklist pré-départ + budget par catégorie.
// Seule partie du site à garder un état éditable en direct (localStorage).
// Lecture et écriture regroupées ici volontairement : c'est un petit module,
// pas besoin de le scinder comme le progress.js du projet mémo pour l'instant.

const STORAGE_KEY = "carnet-slovaquie-pratique";

const DEFAULT_CHECKLIST = [
  { id: "vignette", label: "Vignette autoroute slovaque", done: false },
  { id: "assurance", label: "Assurance véhicule à jour", done: false },
  { id: "matelas", label: "Matelas gonflable + pompe", done: false },
  { id: "trousse", label: "Trousse à pharmacie", done: false },
  { id: "cartes", label: "Cartes de rando téléchargées hors-ligne", done: false },
];

const DEFAULT_BUDGET = [
  { id: "vehicule", label: "Véhicule (location)", amount: 0 },
  { id: "carburant", label: "Carburant", amount: 0 },
  { id: "dodo", label: "Hébergement", amount: 0 },
  { id: "nourriture", label: "Nourriture", amount: 0 },
  { id: "activites", label: "Activités", amount: 0 },
];

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.warn("Lecture localStorage impossible", e);
  }
  return { checklist: DEFAULT_CHECKLIST, budget: DEFAULT_BUDGET };
}

function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn("Écriture localStorage impossible", e);
  }
}

function renderChecklist(state) {
  const el = document.getElementById("checklist-card");
  if (!el) return;
  el.innerHTML = state.checklist
    .map(
      (item) => `
      <label style="display:flex;align-items:center;gap:8px;padding:6px 0;font-size:13px;">
        <input type="checkbox" data-id="${item.id}" ${item.done ? "checked" : ""}>
        <span style="${item.done ? "text-decoration:line-through;color:var(--ink-soft);" : ""}">${item.label}</span>
      </label>`
    )
    .join("");

  el.querySelectorAll("input[type=checkbox]").forEach((cb) => {
    cb.addEventListener("change", () => {
      const item = state.checklist.find((i) => i.id === cb.dataset.id);
      item.done = cb.checked;
      saveState(state);
      renderChecklist(state);
    });
  });
}

function renderBudget(state) {
  const el = document.getElementById("budget-card");
  if (!el) return;
  const total = state.budget.reduce((sum, i) => sum + (Number(i.amount) || 0), 0);

  el.innerHTML =
    state.budget
      .map(
        (item) => `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:6px 0;font-size:13px;">
        <span>${item.label}</span>
        <input type="number" data-id="${item.id}" value="${item.amount}" min="0"
          style="width:80px;text-align:right;font-family:var(--font-mono);border:0.5px solid var(--line);
          border-radius:6px;padding:4px 6px;background:var(--cream-paper);">
      </div>`
      )
      .join("") +
    `<div style="display:flex;justify-content:space-between;padding-top:10px;margin-top:6px;
      border-top:0.5px solid var(--line);font-family:var(--font-mono);font-size:13px;">
      <strong>Total</strong><strong>${total} €</strong>
    </div>`;

  el.querySelectorAll("input[type=number]").forEach((input) => {
    input.addEventListener("input", () => {
      const item = state.budget.find((i) => i.id === input.dataset.id);
      item.amount = Number(input.value) || 0;
      saveState(state);
      renderBudget(state);
    });
  });
}

function renderTtsSpeed() {
  const el = document.getElementById("tts-speed-card");
  if (!el) return;
  const current = getSpeakableRate(); // fournie par slovak.js, chargé avant app.js

  el.innerHTML = `
    <p style="font-size:13px;margin:0 0 8px;">Vitesse de lecture slovaque</p>
    <div style="display:flex;align-items:center;gap:10px;">
      <input type="range" id="tts-speed-range" min="0.5" max="1.1" step="0.05" value="${current}" style="flex:1;">
      <span id="tts-speed-value" style="font-family:var(--font-mono);font-size:12px;min-width:34px;text-align:right;">${current.toFixed(2)}×</span>
    </div>
    <button id="tts-speed-test" class="btn-copy" style="margin-top:8px;">Tester</button>
  `;

  const range = document.getElementById("tts-speed-range");
  const value = document.getElementById("tts-speed-value");
  range.addEventListener("input", () => {
    value.textContent = `${Number(range.value).toFixed(2)}×`;
    localStorage.setItem(TTS_RATE_KEY, range.value);
  });
  document.getElementById("tts-speed-test").addEventListener("click", () => {
    speak("Toto je skúška rýchlosti čítania.", getSpeakableRate());
  });
}

document.addEventListener("DOMContentLoaded", () => {
  const state = loadState();
  renderChecklist(state);
  renderBudget(state);
  renderTtsSpeed();
});

// ---------------------------------------------------------------
// Cartes Leaflet (carnet + étapes) — bouton "agrandir".
// Appelée depuis le <script> inline généré par render_map() dans
// tmd2html.py, juste après l'init de la carte Leaflet elle-même
// (les données des marqueurs sont propres à chaque page, donc cette
// partie-là reste générée côté Python ; seul le comportement du
// bouton, identique partout, est mutualisé ici).
// Les styles associés (.map-embed.map-expanded, .map-expand-btn)
// vivent dans style.css, pas ici.
// ---------------------------------------------------------------
// ---------------------------------------------------------------
// Fonds de carte au choix. Le choix est mémorisé (localStorage) et
// partagé entre toutes les cartes du site. Aucun fond ne demande de
// clé d'API. Si le stockage est indisponible, on retombe sur OSM.
// ---------------------------------------------------------------
const BASE_LAYER_KEY = "carnet-fond-de-carte";

function initBaseLayers(map) {
  const osm = "&copy; <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a>";
  const layers = {
    "Plan (OSM)": L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19, attribution: osm,
    }),
    "Relief (OpenTopoMap)": L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", {
      maxZoom: 17,
      attribution: osm + ", SRTM | &copy; <a href='https://opentopomap.org'>OpenTopoMap</a> (CC-BY-SA)",
    }),
    "Satellite (Esri)": L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      { maxZoom: 19, attribution: "Tiles &copy; Esri, Maxar, Earthstar Geographics" }
    ),
    "Clair (Carto)": L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
      maxZoom: 20, subdomains: "abcd",
      attribution: osm + " &copy; <a href='https://carto.com/attributions'>CARTO</a>",
    }),
  };

  let saved = null;
  try { saved = localStorage.getItem(BASE_LAYER_KEY); } catch (e) { /* stockage indisponible */ }
  const current = layers[saved] ? saved : "Plan (OSM)";
  layers[current].addTo(map);

  L.control.layers(layers, null, { position: "topright", collapsed: true }).addTo(map);
  map.on("baselayerchange", (e) => {
    try { localStorage.setItem(BASE_LAYER_KEY, e.name); } catch (err) { /* ignoré */ }
  });
}

function initMapExpand(map, wrapId, btnId, getBounds) {
  const wrap = document.getElementById(wrapId);
  const btn = document.getElementById(btnId);
  if (!wrap || !btn) return;

  function setExpanded(expanded) {
    wrap.classList.toggle("map-expanded", expanded);
    document.body.classList.toggle("map-scroll-lock", expanded);
    btn.textContent = expanded ? "✕" : "⤢";
    btn.title = expanded ? "Réduire la carte" : "Agrandir la carte";
    btn.setAttribute("aria-label", btn.title);
    // Leaflet doit recalculer sa taille une fois la mise en page à jour
    setTimeout(() => {
      map.invalidateSize();
      const bounds = getBounds && getBounds();
      if (bounds && bounds.length) map.fitBounds(bounds, { padding: [24, 24] });
    }, 220);
  }

  btn.addEventListener("click", () => setExpanded(!wrap.classList.contains("map-expanded")));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && wrap.classList.contains("map-expanded")) setExpanded(false);
  });
}
