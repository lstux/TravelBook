/* Bibliothèque — carte en haut de page.
 *
 * Les lieux sont regroupés en cercles (Leaflet.markercluster), les étapes sont
 * des épingles numérotées. La liste de fiches en dessous suit la carte : seules
 * les fiches situées dans la zone affichée restent visibles. Les fiches sans
 * coordonnées (dodos, tables, culture…) ne sont pas filtrées.
 *
 * Données : window.CARTE_BIBLIO (écrites par tmd2html.py). Sans Leaflet, la
 * page reste une liste complète.
 */
(function () {
  "use strict";

  var DATA = window.CARTE_BIBLIO || { lieux: [], etapes: [] };
  var wrap = document.getElementById("lib-map-wrap");
  var el = document.getElementById("lib-map");
  var countEl = document.getElementById("lib-count");
  if (!el || !wrap) return;

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function popup(m) {
    return '<div class="map-popup"><strong>' + esc(m.titre) + "</strong>" +
      (m.type ? '<div class="map-popup-type">' + esc(m.type) + "</div>" : "") +
      '<a href="' + esc(m.href) + '">Voir la fiche →</a></div>';
  }

  // Sans Leaflet : tout reste affiché, la page fonctionne comme une liste simple.
  if (typeof L === "undefined") {
    wrap.style.display = "none";
    document.querySelector(".lib-legend") && (document.querySelector(".lib-legend").style.display = "none");
    if (countEl) countEl.style.display = "none";
    return;
  }

  var map = L.map("lib-map");
  if (typeof initBaseLayers === "function") initBaseLayers(map);

  var pins = [];
  var lieux = L.markerClusterGroup({
    showCoverageOnHover: false,
    maxClusterRadius: 45,
    iconCreateFunction: function (c) {
      return L.divIcon({
        className: "lib-cluster",
        html: "<span>" + c.getChildCount() + "</span>",
        iconSize: [38, 38],
        iconAnchor: [19, 19]
      });
    }
  });
  DATA.lieux.forEach(function (m) {
    var mk = L.marker([m.lat, m.lon], {
      icon: L.divIcon({ className: "lib-pin lieu", html: "<span></span>", iconSize: [16, 16], iconAnchor: [8, 8] })
    });
    mk.bindPopup(popup(m));
    lieux.addLayer(mk);
    pins.push([m.lat, m.lon]);
  });
  map.addLayer(lieux);

  // Les étapes ne sont pas regroupées : elles restent visibles à toute échelle.
  DATA.etapes.forEach(function (m) {
    var n = parseInt(m.titre, 10) || "";
    L.marker([m.lat, m.lon], {
      icon: L.divIcon({ className: "lib-pin etape", html: "<span>" + n + "</span>", iconSize: [26, 26], iconAnchor: [13, 13] })
    }).addTo(map).bindPopup(popup(m));
    pins.push([m.lat, m.lon]);
  });

  if (pins.length) map.fitBounds(pins, { padding: [24, 24] });
  else map.setView([48.7, 19.5], 7);

  if (typeof initMapExpand === "function") {
    initMapExpand(map, "lib-map-wrap", "lib-map-expand", function () { return pins; });
  }

  // La liste suit la carte : une fiche localisée n'est affichée que si elle est dans la zone visible
  // Lu au moment du filtrage : le script est placé avant la liste dans la page.
  function filterList() {
    var placed = Array.prototype.slice.call(document.querySelectorAll(".index-card[data-lat]"));
    var unplaced = document.querySelectorAll(".index-card:not([data-lat])").length;
    var sections = Array.prototype.slice.call(document.querySelectorAll(".index-section:not(.index-unplaced)"));
    var b = map.getBounds(), shown = 0;
    placed.forEach(function (a) {
      var inside = b.contains([parseFloat(a.getAttribute("data-lat")), parseFloat(a.getAttribute("data-lon"))]);
      a.hidden = !inside;
      if (inside) shown++;
    });
    sections.forEach(function (s) {
      s.hidden = !s.querySelector(".index-card:not([hidden])");
    });
    if (countEl) {
      countEl.textContent = shown + (shown > 1 ? " fiches localisées" : " fiche localisée") +
        " dans la zone · " + unplaced + " sans position, affichées en bas";
    }
  }

  map.on("moveend", filterList);
  // Le DOM de la liste peut ne pas être prêt à l'exécution du script
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", filterList);
  else filterList();
})();
