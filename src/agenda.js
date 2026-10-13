/* Agenda — le programme du voyage jour par jour, sous forme de frise.
 *
 * Les données (window.AGENDA) sont préparées au build par tmd2html.py à partir
 * des étapes et de leurs lieux. Ici on ne fait que de l'affichage et du calcul
 * côté navigateur : tout reste utilisable hors ligne, sur place.
 *
 * Le programme d'une journée est une liste ordonnée de clés :
 *   "l:<id>" = un lieu, "M" = le déjeuner, "D" = le dodo.
 * Heures, trajets, jauge, carte et itinéraire se calculent à partir de cette liste.
 *
 * Réglages de l'utilisateur (date de départ, lieux retenus, ordre, choix du
 * repas) : localStorage, sans jamais bloquer si l'accès échoue.
 */
(function () {
  "use strict";

  var DATA = window.AGENDA || { days: [] };
  var DAYS = DATA.days;
  var KEY = "carnet-agenda";
  var START_TIME = 9 * 60;      // départ indicatif, 9h00
  var LUNCH_AT = 12 * 60;       // par défaut, le déjeuner suit le 1er lieu qui finit après midi
  var LUNCH_MIN = 60;           // pause déjeuner (hors budget)
  var DODO_MIN = 30;            // hauteur indicative du bloc Dodo (hors budget)
  var MAX_WAYPOINTS = 9;        // limite de Google Maps pour une URL d'itinéraire
  var SCALE = 1.1;              // px par minute dans la frise
  var MIN_H = 44;               // hauteur minimale d'un bloc, pour que le texte tienne
  var MEAL_H = 66;
  var LEG_MIN_H = 20;

  var state = load();
  var current = 0;
  var map = null;
  var drag = null;
  var pendingFocus = null;

  function load() {
    try {
      var s = JSON.parse(localStorage.getItem(KEY) || "{}");
      s.off = s.off || {};
      s.on = s.on || {};
      s.meal = s.meal || {};
      s.order = s.order || {};
      return s;
    } catch (e) {
      return { off: {}, on: {}, meal: {}, order: {} };
    }
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* ignoré */ }
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  // ---------- calculs ----------

  function km(a, b) {
    var R = 6371, rad = Math.PI / 180;
    var dLat = (b[0] - a[0]) * rad, dLon = (b[1] - a[1]) * rad;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  // Tout est compté au quart d'heure : un trajet de moins de 8 min est « sur place ».
  function quarter(min) { return Math.round(min / 15) * 15; }

  function driveMin(a, b) {
    if (!a || !b) return 0;
    return quarter(km(a, b) * DATA.detour / DATA.speed * 60);
  }

  function fmt(min) {
    min = Math.round(min);
    var h = Math.floor(min / 60), m = min % 60;
    if (!h) return m + " min";
    return h + "h" + (m ? (m < 10 ? "0" + m : m) : "");
  }

  function clock(min) {
    min = Math.round(min) % (24 * 60);
    var h = Math.floor(min / 60), m = min % 60;
    return h + "h" + (m < 10 ? "0" + m : m);
  }

  function pt(l) { return l.lat != null && l.lon != null ? [l.lat, l.lon] : null; }

  // Un lieu « à éviter » avec des enfants est décoché par défaut, comme un extra.
  function optional(l, extra) { return extra || l.famille === "à-éviter"; }

  function isOn(day, l, extra) {
    var k = day.id + ":" + l.id;
    return optional(l, extra) ? !!state.on[k] : !state.off[k];
  }

  // Tous les lieux candidats du jour : d'abord ceux de la journée, puis les extras.
  function cands(day) {
    return day.lieux.map(function (l) { return { l: l, extra: false }; })
      .concat(day.extras.map(function (l) { return { l: l, extra: true }; }));
  }

  function lieuByKey(day) {
    var m = {};
    cands(day).forEach(function (c) { m["l:" + c.l.id] = c.l; });
    return m;
  }

  function onKeys(day) {
    var s = {};
    cands(day).forEach(function (c) { if (isOn(day, c.l, c.extra)) s["l:" + c.l.id] = true; });
    return s;
  }

  // « Fin de journée » : après le dernier lieu, avant le dodo.
  function insertLate(keys, k) {
    var last = -1;
    keys.forEach(function (x, i) { if (x.indexOf("l:") === 0) last = i; });
    if (last >= 0) { keys.splice(last + 1, 0, k); return; }
    var d = keys.indexOf("D");
    keys.splice(d < 0 ? keys.length : d, 0, k);
  }

  // Déroule le programme dans l'ordre donné : heures, trajets, jauge.
  // Chaque bloc décale tous ceux qui suivent.
  function timing(day, keys) {
    var byKey = lieuByKey(day), base = day.base;
    var start = day.depart || base;
    var t = START_TIME, prev = start, drive = 0, visit = 0;
    var rows = [], stops = [];
    keys.forEach(function (k) {
      if (k === "M") {
        rows.push({ kind: "repas", key: k, at: t, dur: LUNCH_MIN });
        t += LUNCH_MIN;
        return;
      }
      if (k === "D") {
        var legD = driveMin(prev, base);
        t += legD; drive += legD;
        rows.push({ kind: "dodo", key: k, at: t, leg: legD, dur: DODO_MIN });
        prev = base || prev;
        return;
      }
      var l = byKey[k];
      if (!l) return;
      var p = pt(l);
      var leg = p ? driveMin(prev, p) : 0;
      t += leg; drive += leg;
      var arrive = t, stay = quarter(l.min) || 15;
      t += stay; visit += stay;
      rows.push({ kind: "lieu", key: k, lieu: l, leg: leg, arrive: arrive, leave: t, stay: stay });
      stops.push(l);
      if (p) prev = p;
    });
    var back = driveMin(prev, base);
    drive += back; t += back;
    return { start: start, rows: rows, stops: stops, drive: drive, visit: visit,
      back: back, end: t, total: drive + visit };
  }

  // Programme par défaut : lieux retenus dans l'ordre, déjeuner après le 1er lieu
  // qui finit après midi, dodo à la fin.
  function defaultKeys(day) {
    var on = onKeys(day), keys = [];
    cands(day).forEach(function (c) { var k = "l:" + c.l.id; if (on[k]) keys.push(k); });
    var at = null;
    timing(day, keys).rows.forEach(function (r) {
      if (at === null && r.kind === "lieu" && r.leave >= LUNCH_AT) at = r.key;
    });
    keys.splice(at === null ? keys.length : keys.indexOf(at) + 1, 0, "M");
    keys.push("D");
    return keys;
  }

  // Programme effectif : l'ordre enregistré, réconcilié avec les lieux retenus.
  function orderKeys(day) {
    var saved = state.order[day.id];
    if (!saved) return defaultKeys(day);
    var on = onKeys(day), seen = {}, keys = [];
    saved.forEach(function (k) {
      if (seen[k]) return;
      if (k === "M" || k === "D" || on[k]) { keys.push(k); seen[k] = true; }
    });
    if (keys.indexOf("D") < 0) keys.push("D");
    if (keys.indexOf("M") < 0) keys.splice(keys.indexOf("D"), 0, "M");
    cands(day).forEach(function (c) {
      var k = "l:" + c.l.id;
      if (on[k] && !seen[k]) { insertLate(keys, k); seen[k] = true; }
    });
    return keys;
  }

  function plan(day) {
    var keys = orderKeys(day);
    var pl = timing(day, keys);
    pl.keys = keys;
    return pl;
  }

  function verdict(total) {
    var r = total / DATA.budget;
    if (r <= 0.8) return { cls: "ok", txt: "Ça passe" };
    if (r <= 1) return { cls: "tight", txt: "Serré" };
    return { cls: "over", txt: "Trop chargé" };
  }

  function mapsDirUrl(day, pl) {
    var pts = pl.stops.map(pt).filter(Boolean);
    var origin = pl.start, dest = day.base;
    if (!origin || !dest) return null;
    var note = pts.length > MAX_WAYPOINTS;
    pts = pts.slice(0, MAX_WAYPOINTS);
    var c = function (p) { return p[0] + "," + p[1]; };
    var url = "https://www.google.com/maps/dir/?api=1&travelmode=driving&origin=" + c(origin) +
      "&destination=" + c(dest);
    if (pts.length) url += "&waypoints=" + pts.map(c).join("%7C");
    return { url: url, truncated: note };
  }

  // ---------- dates ----------

  function dayDate(i) {
    if (!state.start) return null;
    var d = new Date(state.start + "T12:00:00");
    if (isNaN(d)) return null;
    d.setDate(d.getDate() + i);
    return d;
  }

  function dateLabel(d, long) {
    if (!d) return "";
    return d.toLocaleDateString("fr-FR", long
      ? { weekday: "long", day: "numeric", month: "long" }
      : { weekday: "short", day: "numeric" });
  }

  function todayIndex() {
    if (!state.start) return -1;
    var now = new Date();
    for (var i = 0; i < DAYS.length; i++) {
      var d = dayDate(i);
      if (d && d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() &&
        d.getDate() === now.getDate()) return i;
    }
    return -1;
  }

  // ---------- rendu ----------

  function renderChips() {
    var nav = document.getElementById("agenda-days");
    var ti = todayIndex();
    nav.innerHTML = DAYS.map(function (day, i) {
      var d = dayDate(i);
      var cls = (i === current ? " active" : "") + (i === ti ? " today" : "");
      return '<button type="button" class="agenda-chip' + cls + '" data-i="' + i + '">' +
        '<b>J' + (i + 1) + '</b><span>' + esc(d ? dateLabel(d) : day.etape) + '</span></button>';
    }).join("");
    var act = nav.querySelector(".active");
    if (act && act.scrollIntoView) {
      try { act.scrollIntoView({ block: "nearest", inline: "center" }); } catch (e) { /* ignoré */ }
    }
  }

  function lieuBody(row) {
    var l = row.lieu;
    var meta = "visite " + (l.est ? "~" : "") + fmt(row.stay);
    if (l.lat == null) meta += " · non géolocalisé";
    return '<div class="ag-txt"><span class="ag-time">' + clock(row.arrive) + " – " + clock(row.leave) + "</span>" +
      '<a href="' + esc(l.href) + '">' + esc(l.titre) + "</a><small>" + esc(meta) + "</small></div>";
  }

  function mealBody(day, pl, row) {
    var cur = state.meal[day.id] || "";
    var opts = [
      ["", "On verra bien"],
      ["pique-nique", "Pique-nique"]
    ];
    day.tables.forEach(function (t) {
      opts.push(["T:" + t.id, t.titre + (t.prix ? " (" + t.prix + ")" : "")]);
    });
    var sel = '<select data-meal="' + esc(day.id) + '">' + opts.map(function (o) {
      return '<option value="' + esc(o[0]) + '"' + (o[0] === cur ? " selected" : "") + ">" + esc(o[1]) + "</option>";
    }).join("") + "</select>";
    var link = "";
    if (cur.indexOf("T:") === 0) {
      var t = day.tables.filter(function (x) { return "T:" + x.id === cur; })[0];
      if (t) link = ' <a href="' + esc(t.href) + '">voir la fiche</a>';
    }
    // Restaurants autour de l'endroit où l'on se trouve juste avant le déjeuner
    var near = null, idx = pl.rows.indexOf(row);
    for (var i = idx - 1; i >= 0 && !near; i--) {
      if (pl.rows[i].kind === "lieu" && pt(pl.rows[i].lieu)) near = pt(pl.rows[i].lieu);
    }
    if (!near && pl.start) near = pl.start;
    var search = near
      ? ' · <a target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=' +
      encodeURIComponent("restaurant près de " + near[0] + "," + near[1]) + '">restaurants autour</a>'
      : "";
    return '<div class="ag-txt"><span class="ag-time">' + clock(row.at) + " – " + clock(row.at + row.dur) + "</span>" +
      "<div>🍽 <b>Midi</b> " + sel + link + search + "</div></div>";
  }

  function dodoBody(day, row) {
    var d = day.dodos[0];
    return '<div class="ag-txt"><span class="ag-time">' + clock(row.at) + "</span>" +
      "<div>🛏 <b>Dodo</b> " + (d ? '<a href="' + esc(d.href) + '">' + esc(d.titre) + "</a>" : "non renseigné") +
      "</div></div>";
  }

  // Un bloc de la frise : trajet éventuel au-dessus, puis le bloc dont la hauteur suit la durée.
  function blockHtml(day, pl, row) {
    var leg = row.leg || 0;
    var legH = leg ? Math.max(LEG_MIN_H, Math.round(leg * SCALE)) : 0;
    var bodyH, body, title;
    if (row.kind === "lieu") {
      bodyH = Math.max(MIN_H, Math.round(row.stay * SCALE));
      body = lieuBody(row);
      title = row.lieu.titre;
    } else if (row.kind === "repas") {
      bodyH = Math.max(MEAL_H, Math.round(row.dur * SCALE));
      body = mealBody(day, pl, row);
      title = "le déjeuner";
    } else {
      bodyH = MIN_H;
      body = dodoBody(day, row);
      title = "le dodo";
    }
    return '<div class="ag-blk ag-k-' + row.kind + '" data-key="' + esc(row.key) + '">' +
      (leg ? '<div class="ag-leg" style="min-height:' + legH + 'px">🚗 ~' + fmt(leg) + "</div>" : "") +
      '<div class="ag-body" style="min-height:' + bodyH + 'px">' +
      '<button type="button" class="ag-grip" aria-label="Déplacer ' + esc(title) + '" title="Glisser pour déplacer">⠿</button>' +
      body + "</div></div>";
  }

  // Liste de tous les lieux candidats : cochés = dans le programme.
  function renderCandidates(day) {
    return cands(day).map(function (c) {
      var l = c.l, on = isOn(day, l, c.extra);
      var meta = ["visite " + (l.est ? "~" : "") + fmt(quarter(l.min) || 15)];
      if (l.famille === "à-éviter") meta.push("⚠ déconseillé aux enfants, non retenu par défaut");
      if (l.lat == null) meta.push("non géolocalisé");
      return '<li class="ag-cand' + (on ? "" : " off") + '"><label><input type="checkbox" data-lieu="' +
        esc(l.id) + '" data-extra="' + (optional(l, c.extra) ? 1 : 0) + '"' + (on ? " checked" : "") +
        '> <a href="' + esc(l.href) + '">' + esc(l.titre) + "</a></label>" +
        "<small>" + esc(meta.join(" · ")) + "</small></li>";
    }).join("");
  }

  function renderSleep(day) {
    if (!day.dodos.length) return '<p class="ag-empty">Hébergement non renseigné pour cette étape.</p>';
    return day.dodos.map(function (d, i) {
      var planB = d.planB.length
        ? '<div class="ag-planb">Plan B : ' + d.planB.map(function (p) {
          return '<a href="' + esc(p.href) + '">' + esc(p.titre) + "</a>";
        }).join(", ") + "</div>"
        : "";
      return '<div class="ag-dodo"><span class="ag-tag">' + (i === 0 ? "Prévu" : "Alternative") + "</span> " +
        '<a href="' + esc(d.href) + '">' + esc(d.titre) + "</a>" +
        (d.type ? " <small>" + esc(d.type) + "</small>" : "") + planB + "</div>";
    }).join("");
  }

  function renderDay() {
    var day = DAYS[current];
    var el = document.getElementById("agenda-day");
    if (!day) { el.innerHTML = "<p>Aucun jour à afficher.</p>"; return; }
    var pl = plan(day);
    var v = verdict(pl.total);
    var pct = Math.min(100, Math.round(pl.total / DATA.budget * 100));
    var d = dayDate(current);
    var dir = mapsDirUrl(day, pl);
    var gouter = day.gouter.length
      ? '<p class="ag-gouter">À goûter : ' + day.gouter.map(function (g) {
        return '<a href="' + esc(g.href) + '">' + esc(g.titre) + "</a>";
      }).join(", ") + "</p>"
      : "";
    var blocks = pl.rows.map(function (r) { return blockHtml(day, pl, r); }).join("");

    el.innerHTML =
      '<header class="ag-head"><div class="ag-kicker">Jour ' + (current + 1) + " sur " + DAYS.length +
      (d ? " · " + esc(dateLabel(d, true)) : "") + "</div>" +
      '<h2>' + esc(day.label) + "</h2>" +
      '<div class="ag-etape"><a href="' + esc(day.etapeHref) + '">' + esc(day.etape) + "</a></div></header>" +

      '<div class="ag-gauge ' + v.cls + '"><div class="ag-gauge-top"><b>' + v.txt + "</b><span>" +
      fmt(pl.total) + " sur " + fmt(DATA.budget) + "</span></div>" +
      '<div class="ag-bar"><i style="width:' + pct + '%"></i></div>' +
      "<small>🚶 visites " + fmt(pl.visit) + " · 🚗 conduite ~" + fmt(pl.drive) +
      " · retour à l'étape vers " + clock(pl.end) + "</small></div>" +

      '<div class="map-embed" id="ag-map-wrap"><div id="ag-map" class="leaflet-map"></div>' +
      '<button type="button" class="map-expand-btn" id="ag-map-expand" title="Agrandir la carte" aria-label="Agrandir la carte">⤢</button></div>' +

      (dir
        ? '<p class="ag-dir"><a class="agenda-btn primary" target="_blank" rel="noopener" href="' + esc(dir.url) +
        '">🧭 Itinéraire du jour dans Google Maps</a>' +
        (dir.truncated ? "<small>Google Maps accepte 9 étapes : les suivantes sont omises.</small>" : "") + "</p>"
        : "") +

      '<h3>Programme</h3>' +
      (day.depart
        ? '<p class="ag-note">🚗 Départ de ' + esc(day.departLabel || "l'étape précédente") +
        " — le trajet est compté dans la jauge.</p>"
        : "") +
      '<p class="ag-hint">Glisse la poignée ⠿ pour réorganiser : les heures se recalent toutes seules. ' +
      "Les durées marquées « ~ » sont des estimations, les trajets à vol d'oiseau + 35 %, le tout arrondi au quart d'heure.</p>" +
      '<div id="ag-tl" class="ag-tl" data-no-swipe>' + blocks + "</div>" +
      (state.order[day.id]
        ? '<p class="ag-reset"><button type="button" class="agenda-btn" id="ag-reset">Revenir à l\'ordre d\'origine</button></p>'
        : "") +

      (cands(day).length
        ? "<h3>Lieux du jour</h3><p class=\"ag-hint\">Coche pour ajouter en fin de journée, décoche pour retirer.</p>" +
        '<ul class="ag-list">' + renderCandidates(day) + "</ul>"
        : "") +
      gouter +
      "<h3>Dodo</h3>" + renderSleep(day);

    if (pendingFocus) {
      var g = el.querySelector('.ag-blk[data-key="' + pendingFocus + '"] .ag-grip');
      if (g) g.focus();
      pendingFocus = null;
    }
    initMap(day, pl);
  }

  function initMap(day, pl) {
    if (map) { map.remove(); map = null; }
    if (typeof L === "undefined") {
      document.getElementById("ag-map-wrap").style.display = "none";
      return;
    }
    var pts = [];
    day.lieux.concat(day.extras).forEach(function (l) { if (pt(l)) pts.push(pt(l)); });
    if (day.base) pts.push(day.base);
    if (day.depart) pts.push(day.depart);
    if (!pts.length) { document.getElementById("ag-map-wrap").style.display = "none"; return; }

    map = L.map("ag-map");
    if (typeof initBaseLayers === "function") initBaseLayers(map);
    var n = 0, route = [];
    var icon = function (txt, cls) {
      return L.divIcon({ className: "ag-pin " + cls, html: "<span>" + txt + "</span>", iconSize: [28, 28], iconAnchor: [14, 14] });
    };
    if (pl.start && day.depart) {
      L.marker(pl.start, { icon: icon("⬤", "start") }).addTo(map)
        .bindPopup("<strong>Départ</strong><br>" + esc(day.departLabel || ""));
    }
    route.push(pl.start);
    pl.stops.forEach(function (l) {
      var p = pt(l);
      if (!p) return;
      n += 1;
      route.push(p);
      L.marker(p, { icon: icon(n, "") }).addTo(map)
        .bindPopup('<div class="map-popup"><strong>' + esc(l.titre) + "</strong>" +
          '<a href="' + esc(l.href) + '">Voir la fiche →</a></div>');
    });
    // Lieux non retenus : points gris
    day.lieux.concat(day.extras).forEach(function (l) {
      var p = pt(l);
      if (p && pl.stops.indexOf(l) < 0) {
        L.marker(p, { icon: icon("·", "off") }).addTo(map)
          .bindPopup('<div class="map-popup"><strong>' + esc(l.titre) + "</strong> (non retenu)</div>");
      }
    });
    if (day.base) {
      route.push(day.base);
      L.marker(day.base, { icon: icon("🛏", "bed") }).addTo(map)
        .bindPopup("<strong>Dodo</strong><br>" + esc(day.etape));
    }
    route = route.filter(Boolean);
    if (route.length > 1) L.polyline(route, { className: "route-line" }).addTo(map);
    map.fitBounds(pts, { padding: [24, 24], maxZoom: 13 });
    initMapExpand(map, "ag-map-wrap", "ag-map-expand", function () { return pts; });
  }

  var slide = "";   // "next" | "prev" : sens de l'animation du prochain affichage

  function render() {
    renderChips();
    renderDay();
    var box = document.getElementById("agenda-day");
    if (slide) {
      box.classList.remove("slide-next", "slide-prev");
      void box.offsetWidth;                      // relance l'animation
      box.classList.add("slide-" + slide);
      slide = "";
    }
    try { history.replaceState(null, "", "#j" + (current + 1)); } catch (e) { /* ignoré */ }
    try { localStorage.setItem(KEY + "-last", String(current)); } catch (e) { /* ignoré */ }
  }

  // ---------- glisser pour réorganiser ----------

  function onGripDown(e) {
    var grip = e.target.closest ? e.target.closest(".ag-grip") : null;
    if (!grip || (e.button !== undefined && e.button !== 0)) return;
    var el = grip.closest(".ag-blk"), tl = document.getElementById("ag-tl");
    if (!el || !tl) return;
    var blocks = Array.prototype.slice.call(tl.querySelectorAll(".ag-blk"));
    var centers = blocks.map(function (b) {
      var r = b.getBoundingClientRect();
      return r.top + r.height / 2;
    });
    drag = { el: el, blocks: blocks, centers: centers, idx: blocks.indexOf(el),
      target: blocks.indexOf(el), y0: e.clientY, pid: e.pointerId };
    el.classList.add("dragging");
    try { grip.setPointerCapture(e.pointerId); } catch (err) { /* ignoré */ }
    e.preventDefault();
  }

  function onGripMove(e) {
    if (!drag || e.pointerId !== drag.pid) return;
    var dy = e.clientY - drag.y0;
    drag.el.style.transform = "translateY(" + dy + "px)";
    var c = drag.centers[drag.idx] + dy;
    // Nouvelle position : nombre de blocs (hors celui qu'on tient) situés au-dessus du centre
    var n = 0, others = [];
    drag.blocks.forEach(function (b, i) {
      if (i === drag.idx) return;
      others.push(b);
      if (drag.centers[i] < c) n++;
    });
    drag.target = n;
    drag.blocks.forEach(function (b) { b.classList.remove("ag-drop"); });
    if (n < others.length) others[n].classList.add("ag-drop");
  }

  function endDrag(apply) {
    if (!drag) return;
    var d = drag;
    drag = null;
    d.el.classList.remove("dragging");
    d.el.style.transform = "";
    d.blocks.forEach(function (b) { b.classList.remove("ag-drop"); });
    if (!apply || d.target === d.idx) return;
    var day = DAYS[current];
    var keys = d.blocks.map(function (b) { return b.getAttribute("data-key"); });
    var moved = keys.splice(d.idx, 1)[0];
    keys.splice(d.target, 0, moved);
    state.order[day.id] = keys;
    save();
    renderDay();
  }

  // Clavier : flèches haut/bas sur la poignée
  function onGripKey(e) {
    var grip = e.target.closest ? e.target.closest(".ag-grip") : null;
    if (!grip) return;
    var dir = e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" ? 1 : 0;
    if (!dir) return;
    e.preventDefault();
    var day = DAYS[current], k = grip.closest(".ag-blk").getAttribute("data-key");
    var keys = orderKeys(day), i = keys.indexOf(k), j = i + dir;
    if (i < 0 || j < 0 || j >= keys.length) return;
    keys.splice(i, 1);
    keys.splice(j, 0, k);
    state.order[day.id] = keys;
    save();
    pendingFocus = k;
    renderDay();
  }

  // ---------- événements ----------

  function init() {
    if (!DAYS.length) {
      document.getElementById("agenda-day").innerHTML = "<p>Aucune étape à afficher.</p>";
      return;
    }
    var startInput = document.getElementById("agenda-start");
    startInput.value = state.start || "";
    startInput.addEventListener("change", function () {
      state.start = startInput.value || "";
      save();
      var ti = todayIndex();
      if (ti >= 0) current = ti;
      render();
    });
    document.getElementById("agenda-today").addEventListener("click", function () {
      var ti = todayIndex();
      if (ti >= 0) { current = ti; render(); return; }
      this.textContent = state.start ? "Pas de jour prévu aujourd'hui" : "Renseigne d'abord la date de départ";
      var btn = this;
      setTimeout(function () { btn.textContent = "Aujourd'hui"; }, 2500);
    });
    document.getElementById("agenda-days").addEventListener("click", function (e) {
      var b = e.target.closest(".agenda-chip");
      if (!b) return;
      current = parseInt(b.getAttribute("data-i"), 10);
      render();
    });
    var dayEl = document.getElementById("agenda-day");
    dayEl.addEventListener("change", function (e) {
      var t = e.target, day = DAYS[current];
      if (t.matches("input[data-lieu]")) {
        var k = day.id + ":" + t.getAttribute("data-lieu");
        var lk = "l:" + t.getAttribute("data-lieu");
        // On part de l'ordre affiché, puis on ajoute ou retire le lieu
        var keys = orderKeys(day);
        if (t.getAttribute("data-extra") === "1") {
          if (t.checked) state.on[k] = true; else delete state.on[k];
        } else {
          if (t.checked) delete state.off[k]; else state.off[k] = true;
        }
        if (t.checked) {
          if (keys.indexOf(lk) < 0) insertLate(keys, lk);
        } else {
          keys = keys.filter(function (x) { return x !== lk; });
        }
        state.order[day.id] = keys;
        save();
        renderDay();
      } else if (t.matches("select[data-meal]")) {
        if (t.value) state.meal[day.id] = t.value; else delete state.meal[day.id];
        save();
        renderDay();
      }
    });
    dayEl.addEventListener("click", function (e) {
      if (e.target.closest && e.target.closest("#ag-reset")) {
        delete state.order[DAYS[current].id];
        save();
        renderDay();
      }
    });
    dayEl.addEventListener("pointerdown", onGripDown);
    dayEl.addEventListener("keydown", onGripKey);
    window.addEventListener("pointermove", onGripMove);
    window.addEventListener("pointerup", function () { endDrag(true); });
    window.addEventListener("pointercancel", function () { endDrag(false); });

    // Glisser à gauche/droite : jour suivant/précédent (voir swipe.js)
    window.addEventListener("carnet:swipe", function (e) {
      var dir = e.detail.dir;
      var next = current + (dir === "next" ? 1 : -1);
      if (!DAYS[next]) return;
      e.preventDefault();
      current = next;
      slide = dir;
      window.scrollTo(0, 0);
      render();
    });

    // Jour d'ouverture : #jN > aujourd'hui > dernier consulté > J1
    var h = /^#j(\d+)$/.exec(location.hash || "");
    var ti = todayIndex();
    if (h && DAYS[parseInt(h[1], 10) - 1]) current = parseInt(h[1], 10) - 1;
    else if (ti >= 0) current = ti;
    else {
      try {
        var last = parseInt(localStorage.getItem(KEY + "-last"), 10);
        if (DAYS[last]) current = last;
      } catch (e) { /* ignoré */ }
    }
    render();
  }

  init();
})();
