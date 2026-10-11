// admin2.js — onglet Étapes en version mobile : pas de glisser-déposer
// (peu fiable au tactile), remplacé par un sélecteur de groupe affiché +
// boutons ▲▼ pour réordonner + une liste déroulante pour réaffecter une
// fiche à une autre étape. Partage le même état (admin-core.js, même
// STORAGE_KEY) que la version desktop : les deux pages relisent/écrivent
// le même brouillon.

let currentGroup = "__unassigned__";

function allGroupIds() {
  return ["__unassigned__", ...state.etapesOrder];
}

function groupLabel(id) {
  if (id === "__unassigned__") return "Non classé";
  const meta = ADMIN_DATA.etapes.find((e) => e.basename === id);
  return meta ? meta.titre : id;
}

function groupItems(id) {
  return id === "__unassigned__" ? state.unassigned : state.compositions[id] || [];
}

function setGroupItems(id, items) {
  if (id === "__unassigned__") state.unassigned = items;
  else state.compositions[id] = items;
}

// ---------- Ordre des étapes ----------

function renderEtapeOrder() {
  const el = document.getElementById("etape-order-list");
  el.innerHTML = state.etapesOrder
    .map((name, idx) => {
      const meta = ADMIN_DATA.etapes.find((e) => e.basename === name);
      return `<div class="etape-order-item">
        <span>${idx + 1}. ${escapeHtml(meta ? meta.titre : name)}</span>
        <span>
          <button class="mv-btn" data-move="up" data-etape="${name}" ${idx === 0 ? "disabled" : ""}>▲</button>
          <button class="mv-btn" data-move="down" data-etape="${name}" ${idx === state.etapesOrder.length - 1 ? "disabled" : ""}>▼</button>
        </span>
      </div>`;
    })
    .join("");
}

document.getElementById("etape-order-list").addEventListener("click", (e) => {
  const btn = e.target.closest(".mv-btn");
  if (!btn) return;
  const name = btn.dataset.etape;
  const dir = btn.dataset.move;
  const idx = state.etapesOrder.indexOf(name);
  const swap = dir === "up" ? idx - 1 : idx + 1;
  if (swap < 0 || swap >= state.etapesOrder.length) return;
  [state.etapesOrder[idx], state.etapesOrder[swap]] = [state.etapesOrder[swap], state.etapesOrder[idx]];
  saveState();
  renderEtapeOrder();
  renderGroupSelect();
});

// ---------- Sélecteur de groupe + liste de fiches ----------

function renderGroupSelect() {
  const sel = document.getElementById("group-select");
  const previous = currentGroup;
  sel.innerHTML = allGroupIds()
    .map((id) => {
      const n = groupItems(id).length;
      return `<option value="${id}">${escapeHtml(groupLabel(id))} (${n})</option>`;
    })
    .join("");
  // Le groupe affiché peut avoir disparu (réinitialisation) : on retombe
  // alors sur "Non classé" plutôt que de planter.
  currentGroup = allGroupIds().includes(previous) ? previous : "__unassigned__";
  sel.value = currentGroup;
}

function assignOptionsHtml(selectedId) {
  return allGroupIds()
    .map((id) => `<option value="${id}" ${id === selectedId ? "selected" : ""}>${escapeHtml(groupLabel(id))}</option>`)
    .join("");
}

function cardMobileHtml(basename, idx, total) {
  const f = ADMIN_DATA.fiches[basename];
  if (!f) return "";
  return `<div class="admin-card-mobile family-${f.family}">
    <div class="admin-card-family">${escapeHtml(f.family)}</div>
    <div class="admin-card-title">${escapeHtml(f.titre)}</div>
    <div class="admin-card-region">${escapeHtml(f.region || "")}</div>
    <div class="card-actions-mobile">
      <button class="mv-btn" data-action="up" data-basename="${basename}" ${idx === 0 ? "disabled" : ""}>▲</button>
      <button class="mv-btn" data-action="down" data-basename="${basename}" ${idx === total - 1 ? "disabled" : ""}>▼</button>
      <select class="mv-assign" data-basename="${basename}">${assignOptionsHtml(currentGroup)}</select>
    </div>
  </div>`;
}

function renderCardList() {
  const items = groupItems(currentGroup);
  const el = document.getElementById("mobile-card-list");
  el.innerHTML = items.length
    ? items.map((b, i) => cardMobileHtml(b, i, items.length)).join("")
    : '<p class="empty">Rien ici pour l\u2019instant.</p>';
}

document.getElementById("group-select").addEventListener("change", (e) => {
  currentGroup = e.target.value;
  renderCardList();
});

document.getElementById("mobile-card-list").addEventListener("click", (e) => {
  const btn = e.target.closest(".mv-btn");
  if (!btn) return;
  const basename = btn.dataset.basename;
  const items = groupItems(currentGroup);
  const idx = items.indexOf(basename);
  const swap = btn.dataset.action === "up" ? idx - 1 : idx + 1;
  if (swap < 0 || swap >= items.length) return;
  [items[idx], items[swap]] = [items[swap], items[idx]];
  setGroupItems(currentGroup, items);
  saveState();
  renderCardList();
});

document.getElementById("mobile-card-list").addEventListener("change", (e) => {
  const sel = e.target.closest(".mv-assign");
  if (!sel) return;
  const basename = sel.dataset.basename;
  const target = sel.value;
  if (target === currentGroup) return;
  setGroupItems(currentGroup, groupItems(currentGroup).filter((b) => b !== basename));
  setGroupItems(target, [...groupItems(target), basename]);
  saveState();
  renderCardList();
  renderGroupSelect();
});

function renderEtapesPanel() {
  renderEtapeOrder();
  renderGroupSelect();
  renderCardList();
}

document.getElementById("reset-btn").addEventListener("click", () => resetState(renderEtapesPanel));
renderEtapesPanel();
