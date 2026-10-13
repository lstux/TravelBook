/* Navigation au doigt : glisser vers la gauche = suivant, vers la droite = précédent.
 *
 * Le module ne connaît aucune page. Il cherche d'abord un gestionnaire (l'agenda
 * écoute l'événement "carnet:swipe"), sinon il suit les liens .fiche-nav déjà
 * présents dans la page (fiche précédente/suivante, étape précédente/suivante,
 * épisode précédent/suivant). Pas de lien = rien ne se passe.
 */
(function () {
  "use strict";

  var MIN_DX = 70;        // distance horizontale minimale (px)
  var RATIO = 1.8;        // le geste doit être nettement plus horizontal que vertical
  var MAX_MS = 700;       // un glissement lent n'est pas un swipe
  var EDGE = 24;          // bords réservés au geste « retour » du système
  var BLOCKED = ".leaflet-container, .map-expanded, input, select, textarea, .agenda-days, [data-no-swipe]";

  var start = null;

  function scrollsHorizontally(el) {
    for (; el && el !== document.body && el.nodeType === 1; el = el.parentElement) {
      var ox = getComputedStyle(el).overflowX;
      if ((ox === "auto" || ox === "scroll") && el.scrollWidth > el.clientWidth + 2) return true;
    }
    return false;
  }

  document.addEventListener("touchstart", function (e) {
    start = null;
    if (e.touches.length !== 1) return;
    var t = e.touches[0];
    if (t.clientX < EDGE || t.clientX > window.innerWidth - EDGE) return;
    var target = e.target;
    if (target.closest && target.closest(BLOCKED)) return;
    if (scrollsHorizontally(target)) return;
    start = { x: t.clientX, y: t.clientY, time: Date.now() };
  }, { passive: true });

  document.addEventListener("touchend", function (e) {
    if (!start) return;
    var s = start;
    start = null;
    var t = e.changedTouches[0];
    var dx = t.clientX - s.x, dy = t.clientY - s.y;
    if (Math.abs(dx) < MIN_DX || Math.abs(dx) < Math.abs(dy) * RATIO) return;
    if (Date.now() - s.time > MAX_MS) return;
    if (String(window.getSelection && window.getSelection()).length) return;

    var dir = dx < 0 ? "next" : "prev";
    var handled = !window.dispatchEvent(new CustomEvent("carnet:swipe", { detail: { dir: dir }, cancelable: true }));
    if (handled) return;
    var link = document.querySelector(".fiche-nav .nav-link." + dir + "[href]");
    if (link) location.href = link.href;
  }, { passive: true });
})();
