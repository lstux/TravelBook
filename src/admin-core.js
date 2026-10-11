// admin-core.js — partagé entre admin.html (Kanban desktop) et
// admin2.html (mobile). Contient tout ce qui ne dépend pas du mode
// d'interaction : état/localStorage, onglets, carte filtrée, export.
// Chaque page ajoute ensuite son propre script pour l'onglet Étapes.

const STORAGE_KEY = "carnet-admin-state-v1";

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

// ==========================================================================
// État
// ==========================================================================

function initStateFromData() {
  const etapesOrder = ADMIN_DATA.etapes.map((e) => e.basename);
  const compositions = {};
  etapesOrder.forEach((name) => {
    compositions[name] = (ADMIN_DATA.compositions[name] || []).filter(
      (b) => ADMIN_DATA.fiches[b]
    );
  });
  const assigned = new Set(Object.values(compositions).flat());
  const unassigned = Object.keys(ADMIN_DATA.fiches).filter((b) => !assigned.has(b));
  return { etapesOrder, compositions, unassigned };
}

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      return JSON.parse(raw);
    } catch (e) {
      console.warn("État admin corrompu, réinitialisation", e);
    }
  }
  return initStateFromData();
}

let state = loadState();

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

// onRender : fonction à rappeler après reset pour redessiner la vue
// spécifique à la page (Kanban ou liste mobile).
function resetState(onRender) {
  if (!confirm("Repartir de l'état des fichiers ? Les réorganisations non exportées seront perdues.")) {
    return;
  }
  localStorage.removeItem(STORAGE_KEY);
  state = initStateFromData();
  saveState();
  if (map) renderMapMarkers();
  if (typeof onRender === "function") onRender();
}

// ==========================================================================
// Onglets (markup identique sur les deux pages)
// ==========================================================================

document.querySelectorAll(".admin-tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".admin-tab").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".admin-panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("panel-" + btn.dataset.tab).classList.add("active");

    if (btn.dataset.tab === "carte") {
      initMapIfNeeded();
      setTimeout(() => map.invalidateSize(), 0);
      renderMapMarkers();
    }
    if (btn.dataset.tab === "export") {
      renderExport();
    }
  });
});

// ==========================================================================
// Onglet Carte — filtrée par région / statut / recherche
// ==========================================================================

let map = null;
let markersLayer = null;

function initMapIfNeeded() {
  if (map) return;
  map = L.map("admin-map");
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap",
  }).addTo(map);
  markersLayer = L.layerGroup().addTo(map);

  const regions = [...new Set(Object.values(ADMIN_DATA.fiches).map((f) => f.region).filter(Boolean))].sort();
  const sel = document.getElementById("filter-region");
  regions.forEach((r) => {
    const opt = document.createElement("option");
    opt.value = r;
    opt.textContent = r;
    sel.appendChild(opt);
  });

  ["filter-region", "filter-status"].forEach((id) =>
    document.getElementById(id).addEventListener("change", renderMapMarkers)
  );
  document.getElementById("filter-search").addEventListener("input", renderMapMarkers);
}

function ficheStatus(basename) {
  if (Object.values(state.compositions).some((list) => list.includes(basename))) return "assigne";
  const f = ADMIN_DATA.fiches[basename];
  if (f && f.candidates && f.candidates.length) return "candidat";
  return "nonclasse";
}

const STATUS_LABELS = { assigne: "Assigné", candidat: "Candidat", nonclasse: "Non classé" };

function renderMapMarkers() {
  if (!map) return;
  markersLayer.clearLayers();
  const region = document.getElementById("filter-region").value;
  const status = document.getElementById("filter-status").value;
  const q = document.getElementById("filter-search").value.trim().toLowerCase();
  const bounds = [];

  Object.entries(ADMIN_DATA.fiches).forEach(([basename, f]) => {
    if (f.lat == null || f.lon == null) return;
    if (region && f.region !== region) return;
    const st = ficheStatus(basename);
    if (status && st !== status) return;
    if (q && !`${f.titre} ${f.region || ""}`.toLowerCase().includes(q)) return;

    const marker = L.marker([f.lat, f.lon]).addTo(markersLayer);
    marker.bindPopup(
      `<div class="map-popup"><strong>${escapeHtml(f.titre)}</strong>` +
      `<div class="map-popup-type">${escapeHtml(f.region || "")} · ${STATUS_LABELS[st]}</div>` +
      `<a href="${escapeHtml(basename)}.html" target="_blank">Voir la fiche →</a></div>`
    );
    bounds.push([f.lat, f.lon]);
  });

  if (bounds.length) map.fitBounds(bounds, { padding: [24, 24] });
}

// ==========================================================================
// Onglet Export
// ==========================================================================

function renderExport() {
  const container = document.getElementById("export-content");
  let html = `<div class="card"><div class="label">etapes.txt</div>
    <p class="admin-hint">Ordre global du voyage — remplace le contenu de <code>md/etapes.txt</code>.</p>
    <textarea readonly class="export-box" id="export-etapes-txt">${escapeHtml(state.etapesOrder.join("\n"))}</textarea>
    <button class="btn-copy" data-target="export-etapes-txt">Copier</button></div>`;

  state.etapesOrder.forEach((name) => {
    const meta = ADMIN_DATA.etapes.find((e) => e.basename === name);
    const lines = (state.compositions[name] || []).map((b) => `-> ${b}`).join("\n");
    html += `<div class="card"><div class="label">${escapeHtml(meta ? meta.titre : name)}</div>
      <p class="admin-hint">À coller à la place des lignes <code>-></code> existantes dans
      <code>md/${escapeHtml(name)}.md</code> — garde l'intro, les champs <code>+</code> et l'anecdote tels quels.</p>
      <textarea readonly class="export-box" id="export-${escapeHtml(name)}">${escapeHtml(lines)}</textarea>
      <button class="btn-copy" data-target="export-${escapeHtml(name)}">Copier</button></div>`;
  });

  container.innerHTML = html;
  container.querySelectorAll(".btn-copy").forEach((btn) => {
    btn.addEventListener("click", () => copyTextarea(btn));
  });
}

function copyTextarea(btn) {
  const ta = document.getElementById(btn.dataset.target);
  ta.removeAttribute("readonly");
  ta.select();
  ta.setSelectionRange(0, 999999);
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch (e) {
    ok = false;
  }
  ta.setAttribute("readonly", "readonly");
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(ta.value).catch(() => {});
  }
  if (ok) {
    btn.textContent = "Copié ✓";
    btn.classList.add("copied");
    setTimeout(() => {
      btn.textContent = "Copier";
      btn.classList.remove("copied");
    }, 1500);
  }
}
