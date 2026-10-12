/* Agenda — le programme du voyage jour par jour.
 *
 * Les données (window.AGENDA) sont préparées au build par tmd2html.py à partir
 * des étapes et de leurs lieux. Ici on ne fait que de l'affichage et du calcul
 * côté navigateur : tout reste utilisable hors ligne, sur place.
 *
 * Réglages de l'utilisateur (date de départ, lieux décochés, extras ajoutés,
 * choix du repas) : localStorage, sans jamais bloquer si l'accès échoue.
 */
(function () {
  "use strict";

  var DATA = window.AGENDA || { days: [] };
  var DAYS = DATA.days;
  var KEY = "carnet-agenda";
  var START_TIME = 9 * 60;      // départ indicatif, 9h00
  var LUNCH_AT = 12 * 60;       // le déjeuner s'insère après le 1er lieu qui finit après midi
  var LUNCH_MIN = 60;           // pause déjeuner (hors budget)
  var MAX_WAYPOINTS = 9;        // limite de Google Maps pour une URL d'itinéraire

  var state = load();
  var current = 0;
  var map = null;

  function load() {
    try {
      var s = JSON.parse(localStorage.getItem(KEY) || "{}");
      s.off = s.off || {};
      s.on = s.on || {};
      s.meal = s.meal || {};
      return s;
    } catch (e) {
      return { off: {}, on: {}, meal: {} };
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

  function driveMin(a, b) {
    if (!a || !b) return 0;
    return Math.round(km(a, b) * DATA.detour / DATA.speed * 60);
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

  function isOn(day, l, extra) {
    var k = day.id + ":" + l.id;
    return extra ? !!state.on[k] : !state.off[k];
  }

  function plan(day) {
    var stops = [];
    day.lieux.forEach(function (l) { if (isOn(day, l, false)) stops.push(l); });
    day.extras.forEach(function (l) { if (isOn(day, l, true)) stops.push(l); });

    var start = day.depart || day.base;
    var rows = [], t = START_TIME, prev = start, drive = 0, visit = 0, lunchDone = false;
    stops.forEach(function (l) {
      var p = pt(l);
      var leg = p ? driveMin(prev, p) : 0;
      t += leg; drive += leg;
      var arrive = t;
      t += l.min; visit += l.min;
      rows.push({ kind: "lieu", lieu: l, leg: leg, arrive: arrive, leave: t });
      if (p) prev = p;
      if (!lunchDone && t >= LUNCH_AT) {
        rows.push({ kind: "repas", at: t });
        t += LUNCH_MIN; lunchDone = true;
      }
    });
    var back = driveMin(prev, day.base);
    t += back; drive += back;
    return { stops: stops, rows: rows, drive: drive, visit: visit, back: back, end: t,
      total: drive + visit, start: start, lunchDone: lunchDone };
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

  function lieuRow(day, l, extra, row) {
    var on = isOn(day, l, extra);
    var meta = [];
    if (row && row.leg) meta.push("🚗 ~" + fmt(row.leg));
    meta.push("visite " + (l.est ? "~" : "") + fmt(l.min));
    if (l.famille === "à-éviter") meta.push("⚠ déconseillé aux enfants");
    var times = '<span class="ag-time">' + (row ? clock(row.arrive) : "—") + "</span>";
    return '<li class="ag-stop' + (on ? "" : " off") + (extra ? " extra" : "") + '">' + times +
      '<label><input type="checkbox" data-lieu="' + esc(l.id) + '" data-extra="' + (extra ? 1 : 0) + '"' +
      (on ? " checked" : "") + '> <a href="' + esc(l.href) + '">' + esc(l.titre) + "</a></label>" +
      '<small>' + esc(meta.join(" · ")) + (l.lat == null ? " · non géolocalisé" : "") + "</small></li>";
  }

  function renderStops(day, pl) {
    var rowsByLieu = {};
    pl.rows.forEach(function (r) { if (r.kind === "lieu") rowsByLieu[r.lieu.id] = r; });
    var html = "";
    if (day.depart) {
      html += '<li class="ag-note">🚗 Départ de ' + esc(day.departLabel || "l'étape précédente") +
        " — le trajet est compté dans la jauge.</li>";
    }
    var seq = pl.rows.slice();
    day.lieux.forEach(function (l) {
      var r = rowsByLieu[l.id];
      html += lieuRow(day, l, false, r);
      if (r) html += lunchAfter(day, seq, r);
    });
    if (day.extras.length) {
      html += '<li class="ag-sep">En option, si le temps le permet</li>';
      day.extras.forEach(function (l) {
        var r = rowsByLieu[l.id];
        html += lieuRow(day, l, true, r);
        if (r) html += lunchAfter(day, seq, r);
      });
    }
    if (!pl.lunchDone) html += mealRow(day, null);
    return html;
  }

  function lunchAfter(day, seq, r) {
    var i = seq.indexOf(r);
    if (i >= 0 && seq[i + 1] && seq[i + 1].kind === "repas") return mealRow(day, seq[i + 1].at);
    return "";
  }

  function mealRow(day, at) {
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
    // Recherche de restaurants autour de l'endroit où l'on sera à midi
    var near = null;
    var pl = plan(day);
    for (var i = 0; i < pl.rows.length; i++) {
      if (pl.rows[i].kind === "lieu" && pt(pl.rows[i].lieu)) {
        near = pt(pl.rows[i].lieu);
        if (pl.rows[i].leave >= LUNCH_AT) break;
      }
    }
    var search = near
      ? ' · <a target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=' +
      encodeURIComponent("restaurant près de " + near[0] + "," + near[1]) + '">restaurants autour</a>'
      : "";
    return '<li class="ag-meal"><span class="ag-time">' + (at ? clock(at) : "") + "</span>" +
      "<div>🍽 <b>Midi</b> " + sel + link + search + "</div></li>";
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

      '<h3>Programme</h3><ul class="ag-list">' + renderStops(day, pl) + "</ul>" +
      '<p class="ag-hint">Décoche un lieu pour voir si la journée respire mieux. Les durées marquées « ~ » sont des estimations, les trajets sont à vol d\'oiseau + 35 %.</p>' +
      gouter +
      "<h3>Dodo</h3>" + renderSleep(day);

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
    // Lieux décochés : points gris
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

  function render() {
    renderChips();
    renderDay();
    try { history.replaceState(null, "", "#j" + (current + 1)); } catch (e) { /* ignoré */ }
    try { localStorage.setItem(KEY + "-last", String(current)); } catch (e) { /* ignoré */ }
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
    document.getElementById("agenda-day").addEventListener("change", function (e) {
      var t = e.target, day = DAYS[current];
      if (t.matches("input[data-lieu]")) {
        var k = day.id + ":" + t.getAttribute("data-lieu");
        if (t.getAttribute("data-extra") === "1") {
          if (t.checked) state.on[k] = true; else delete state.on[k];
        } else {
          if (t.checked) delete state.off[k]; else state.off[k] = true;
        }
        save();
        renderDay();
      } else if (t.matches("select[data-meal]")) {
        if (t.value) state.meal[day.id] = t.value; else delete state.meal[day.id];
        save();
        renderDay();
      }
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
