// admin.js — onglet Étapes en version desktop : tableau Kanban,
// glisser-déposer à la souris. Le reste (état, carte, export) vit dans
// admin-core.js, chargé juste avant ce fichier.

function cardHtml(basename) {
  const f = ADMIN_DATA.fiches[basename];
  if (!f) return "";
  return `<div class="admin-card family-${f.family}" draggable="true" data-basename="${basename}">
    <div class="admin-card-family">${escapeHtml(f.family)}</div>
    <div class="admin-card-title">${escapeHtml(f.titre)}</div>
    <div class="admin-card-region">${escapeHtml(f.region || "")}</div>
  </div>`;
}

function columnHtml(colId, title, idx, items) {
  const arrows = idx === null ? "" : `
    <span>
      <button class="col-arrow" data-move="up" data-col="${colId}" ${idx === 0 ? "disabled" : ""}>↑</button>
      <button class="col-arrow" data-move="down" data-col="${colId}" ${idx === state.etapesOrder.length - 1 ? "disabled" : ""}>↓</button>
    </span>`;
  return `<div class="kanban-col">
    <div class="kanban-col-header"><span class="col-title">${escapeHtml(title)}</span>${arrows}</div>
    <div class="kanban-col-body" data-col="${colId}">
      ${items.map(cardHtml).join("")}
    </div>
  </div>`;
}

function renderBoard() {
  const board = document.getElementById("kanban-board");
  let html = columnHtml("__unassigned__", `Non classé (${state.unassigned.length})`, null, state.unassigned);
  state.etapesOrder.forEach((name, idx) => {
    const meta = ADMIN_DATA.etapes.find((e) => e.basename === name);
    const items = state.compositions[name] || [];
    html += columnHtml(name, `${meta ? meta.titre : name} (${items.length})`, idx, items);
  });
  board.innerHTML = html;
  attachDnD();
}

function attachDnD() {
  document.querySelectorAll(".admin-card").forEach((card) => {
    card.addEventListener("dragstart", () => card.classList.add("dragging"));
    card.addEventListener("dragend", () => {
      card.classList.remove("dragging");
      commitColumnOrder();
    });
  });

  document.querySelectorAll(".kanban-col-body").forEach((col) => {
    col.addEventListener("dragover", (e) => {
      e.preventDefault();
      const dragging = document.querySelector(".dragging");
      if (!dragging) return;
      const after = getDragAfterElement(col, e.clientY);
      if (after == null) col.appendChild(dragging);
      else col.insertBefore(dragging, after);
    });
  });
}

function getDragAfterElement(container, y) {
  const els = [...container.querySelectorAll(".admin-card:not(.dragging)")];
  return els.reduce(
    (closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) {
        return { offset, element: child };
      }
      return closest;
    },
    { offset: -Infinity, element: null }
  ).element;
}

function commitColumnOrder() {
  const compositions = {};
  let unassigned = [];
  document.querySelectorAll(".kanban-col-body").forEach((col) => {
    const colId = col.dataset.col;
    const basenames = [...col.querySelectorAll(".admin-card")].map((c) => c.dataset.basename);
    if (colId === "__unassigned__") unassigned = basenames;
    else compositions[colId] = basenames;
  });
  state.compositions = compositions;
  state.unassigned = unassigned;
  saveState();
  updateColumnCounts();
}

function updateColumnCounts() {
  const unassignedCol = document.querySelector('[data-col="__unassigned__"]');
  const unassignedHeader = unassignedCol && unassignedCol.closest(".kanban-col").querySelector(".col-title");
  if (unassignedHeader) unassignedHeader.textContent = `Non classé (${state.unassigned.length})`;

  state.etapesOrder.forEach((name) => {
    const meta = ADMIN_DATA.etapes.find((e) => e.basename === name);
    const col = document.querySelector(`[data-col="${name}"]`);
    const header = col && col.closest(".kanban-col").querySelector(".col-title");
    if (header) {
      const n = (state.compositions[name] || []).length;
      header.textContent = `${meta ? meta.titre : name} (${n})`;
    }
  });
}

document.getElementById("kanban-board").addEventListener("click", (e) => {
  const btn = e.target.closest(".col-arrow");
  if (!btn) return;
  const col = btn.dataset.col;
  const dir = btn.dataset.move;
  const idx = state.etapesOrder.indexOf(col);
  const swapIdx = dir === "up" ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= state.etapesOrder.length) return;
  [state.etapesOrder[idx], state.etapesOrder[swapIdx]] = [state.etapesOrder[swapIdx], state.etapesOrder[idx]];
  saveState();
  renderBoard();
});

document.getElementById("reset-btn").addEventListener("click", () => resetState(renderBoard));
renderBoard();
