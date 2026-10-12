#!/usr/bin/env python3
"""
tmd2html.py — convertit les fiches TMD (Travel MarkDown) du carnet Slovaquie
en pages HTML statiques : fiches individuelles + vues Carnet / Bibliothèque /
Brouillon / Pratique.

Usage :
    python3 tmd2html.py

Lit  : md/*.md, md/etapes.txt
Écrit: html/*.html (jamais retouché à la main)
"""

import argparse
import json
import os
import re
import unicodedata
from pathlib import Path

# ROOT = moteur (src/, icons/, service-worker.js, html/ généré).
# DATA = dépôt de données (md/, pages/, img/, manifest.json, caches).
# Ordre de résolution : option --data, puis $CARNET_DATA, puis <moteur>/data.
ROOT = Path(__file__).resolve().parent.parent
HTML_DIR = ROOT / "html"

DATA = MD_DIR = PAGES_DIR = GEOCACHE_PATH = None   # fixés par set_data_dir()


def resolve_data_dir(value=None):
    """Dossier des données : valeur explicite, sinon $CARNET_DATA, sinon <moteur>/data."""
    return Path(value or os.environ.get("CARNET_DATA") or ROOT / "data").expanduser().resolve()


def set_data_dir(value=None):
    """Fixe les chemins dérivés des données et renvoie le dossier retenu."""
    global DATA, MD_DIR, PAGES_DIR, GEOCACHE_PATH
    DATA = resolve_data_dir(value)
    MD_DIR = DATA / "md"
    PAGES_DIR = DATA / "pages"
    GEOCACHE_PATH = DATA / "geocache.json"
    return DATA


def add_data_argument(parser):
    parser.add_argument(
        "-d", "--data", metavar="DIR",
        help="dossier des données (défaut : $CARNET_DATA, sinon <moteur>/data)",
    )


set_data_dir()


def read_static_fragment(name):
    """Lit un fragment HTML écrit à la main dans pages/<name> — pour les
    pages qui n'ont pas vocation à être régénérées depuis des fiches .md
    (contenu éditorial figé, qu'on ne réécrira pour ainsi dire jamais).
    Fichier absent -> chaîne vide, dégradation gracieuse comme le reste
    du pipeline : jamais d'erreur bloquante pour un fichier manquant."""
    path = PAGES_DIR / name
    return path.read_text(encoding="utf-8") if path.exists() else ""

FAMILIES = ["Lieu", "Dodo", "Specialite", "Table", "Culture", "Etape"]

TABS = [
    ("carnet.html", "Carnet", "route"),
    ("pays.html", "Pays", "flag"),
    ("bibliotheque.html", "Bibliothèque", "book"),
    ("brouillon.html", "Brouillon", "notes"),
    ("pratique.html", "Pratique", "check"),
]

ICONS = {
    "route": '<path d="M4 19c3-6 5-6 8-12M20 5c-3 6-5 6-8 12" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/>',
    "flag": '<path d="M6 3v18" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M6 4h12l-3 3.5L18 11H6" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linejoin="round"/>',
    "book": '<path d="M4 5c2-1 5-1 7 0v14c-2-1-5-1-7 0V5zM20 5c-2-1-5-1-7 0v14c2-1 5-1 7 0V5z" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linejoin="round"/>',
    "notes": '<path d="M6 4h9l4 4v12H6V4z" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linejoin="round"/><path d="M9 12h7M9 16h5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
    "check": '<path d="M5 13l4 4 10-10" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
}


# ----------------------------------------------------------------------
# Utilitaires
# ----------------------------------------------------------------------

def slugify(text):
    if not text:
        return ""
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    text = text.lower()
    text = re.sub(r"[^a-z0-9]+", "-", text).strip("-")
    return text


def family_of(basename):
    for fam in FAMILIES:
        if basename.startswith(fam + "_") or basename == fam:
            return fam
    return "Autre"


HEADER_LINE = re.compile(r"^([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ \-]*)\s*:\s*(.*)$")
PAREN_ATTRS = re.compile(r"\(([^)]*)\)")


def parse_attrs(s):
    """'clé: val, clé: val' -> {clé: val}"""
    attrs = {}
    for part in s.split(","):
        if ":" in part:
            k, v = part.split(":", 1)
            attrs[k.strip()] = v.strip()
    return attrs


# ----------------------------------------------------------------------
# Parsing d'une fiche TMD
# ----------------------------------------------------------------------

def parse_fiche(path):
    basename = path.stem
    family = family_of(basename)
    lines = path.read_text(encoding="utf-8").splitlines()

    header = {}
    elements = []
    in_header = True
    i = 0
    while i < len(lines):
        line = lines[i].rstrip()
        stripped = line.strip()

        if not stripped:
            if elements and elements[-1]["type"] in ("narrative-start", "narrative-text"):
                elements.append({"type": "narrative-parabreak"})
            i += 1
            continue

        if in_header:
            m = HEADER_LINE.match(stripped)
            if m and not stripped.startswith(("#", "+", "!", "@", "->", "==")):
                header[m.group(1).strip()] = m.group(2).strip()
                i += 1
                continue
            else:
                in_header = False
                # ne pas consommer la ligne, retomber dans le parsing de corps

        if stripped.startswith("## "):
            elements.append({"type": "narrative-start", "label": stripped[3:].strip()})

        elif stripped.startswith("# "):
            body = stripped[2:].strip()
            m = re.match(r"([a-zà-ÿ\-]+)\s*(\(.*\))?", body)
            name = m.group(1) if m else body
            attrs = {}
            pm = PAREN_ATTRS.search(body)
            if pm:
                attrs = parse_attrs(pm.group(1))
            elements.append({"type": "chiffre", "name": name, "attrs": attrs})

        elif stripped.startswith("+ "):
            content = stripped[2:].strip()
            if "->" in content:
                label, targets = content.split("->", 1)
                label = label.rstrip(": ").strip()
                targets = [t.strip() for t in targets.split(",") if t.strip()]
                elements.append({"type": "field-link", "label": label, "targets": targets})
            elif ":" in content:
                label, value = content.split(":", 1)
                elements.append({"type": "field", "label": label.strip(), "value": value.strip()})
            else:
                elements.append({"type": "field", "label": "", "value": content})

        elif stripped.startswith("! "):
            elements.append({"type": "anecdote-start"})
            rest = stripped[2:].strip()
            if rest and rest.lower() != "anecdote":
                elements.append({"type": "anecdote-text", "text": rest})

        elif stripped == "!":
            elements.append({"type": "anecdote-start"})

        elif stripped.startswith("@ "):
            body = stripped[2:].strip()
            if "|" in body:
                imgpath, caption = body.split("|", 1)
            else:
                imgpath, caption = body, ""
            elements.append({"type": "image", "path": imgpath.strip(), "caption": caption.strip()})

        elif stripped.startswith("-> "):
            elements.append({"type": "link", "target": stripped[3:].strip()})

        elif stripped.startswith("~"):
            elements.append({"type": "translation", "text": stripped[1:].strip()})

        elif stripped.startswith("=="):
            elements.append({"type": "day", "label": stripped.lstrip("=").strip()})

        elif elements and elements[-1]["type"] in ("narrative-start", "narrative-text", "narrative-parabreak"):
            # ligne de suite d'un bloc narratif ## (paragraphe multi-lignes)
            elements.append({"type": "narrative-text", "text": stripped})

        elif elements and elements[-1]["type"] in ("anecdote-start", "anecdote-text"):
            # ligne de suite d'une anecdote (paragraphe multi-lignes)
            elements.append({"type": "anecdote-text", "text": stripped})

        i += 1

    # fusionne les anecdote-start / anecdote-text et narrative-start / narrative-text
    # / narrative-parabreak consécutifs en blocs uniques
    merged = []
    buf = None          # anecdote en cours
    narr = None         # bloc narratif ## en cours

    def flush_buf():
        nonlocal buf
        if buf is not None:
            merged.append(buf)
            buf = None

    def flush_narr():
        nonlocal narr
        if narr is not None:
            narr["paragraphs"] = [p for p in narr["paragraphs"] if p]
            merged.append(narr)
            narr = None

    for el in elements:
        if el["type"] == "anecdote-start":
            flush_narr()
            flush_buf()
            buf = {"type": "anecdote", "text": ""}
        elif el["type"] == "anecdote-text":
            if buf is None:
                buf = {"type": "anecdote", "text": ""}
            buf["text"] = (buf["text"] + " " + el["text"]).strip()
        elif el["type"] == "narrative-start":
            flush_buf()
            flush_narr()
            narr = {"type": "narrative", "label": el["label"], "paragraphs": [""]}
        elif el["type"] == "narrative-text":
            if narr is None:
                narr = {"type": "narrative", "label": "", "paragraphs": [""]}
            if narr["paragraphs"][-1]:
                narr["paragraphs"][-1] += " " + el["text"]
            else:
                narr["paragraphs"][-1] = el["text"]
        elif el["type"] == "narrative-parabreak":
            if narr is not None and narr["paragraphs"][-1]:
                narr["paragraphs"].append("")
        else:
            flush_buf()
            flush_narr()
            merged.append(el)
    flush_buf()
    flush_narr()

    # Deuxième passe : une ligne "~ traduction" s'accroche au bloc
    # juste au-dessus (champ, avis, anecdote...) comme clé "sk".
    # Absente = pas de bouton "écouter" pour ce bloc, dégradation gracieuse.
    with_translations = []
    for el in merged:
        if el["type"] == "translation":
            if with_translations and "sk" not in with_translations[-1]:
                with_translations[-1]["sk"] = el["text"]
            continue
        with_translations.append(el)
    merged = with_translations

    thumbnail = None
    for el in merged:
        if el["type"] == "image":
            thumbnail = {"path": el["path"], "caption": el["caption"]}
            break

    return {
        "basename": basename,
        "family": family,
        "header": header,
        "elements": merged,
        "thumbnail": thumbnail,
    }


def load_all_fiches():
    if not MD_DIR.is_dir():
        raise SystemExit(
            f"Dossier de données introuvable : {MD_DIR}\n"
            "Indique-le avec --data DIR, ou avec la variable CARNET_DATA, "
            "ou clone les données dans <moteur>/data."
        )
    fiches = {}
    for path in sorted(MD_DIR.glob("*.md")):
        f = parse_fiche(path)
        fiches[f["basename"]] = f
    return fiches


# ----------------------------------------------------------------------
# Rendu HTML — briques communes
# ----------------------------------------------------------------------

def esc(s):
    return (s or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def speakable_html(sk):
    return f'<div class="speakable">{esc(sk)}</div>' if sk else ""


def img_src(path):
    """Chemin d'image : URL absolue telle quelle, chemin local préfixé de
    '../' (les pages HTML vivent dans html/, les images à la racine)."""
    return path if path.startswith(("http://", "https://")) else f"../{path}"


# ----------------------------------------------------------------------
# Géolocalisation (cache produit par geocode.py) et cartes Leaflet
# ----------------------------------------------------------------------


def load_geocache():
    if not GEOCACHE_PATH.exists():
        return {}
    try:
        return json.loads(GEOCACHE_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def attach_coordinates(fiches, geocache):
    for basename, fiche in fiches.items():
        coords = geocache.get(basename)
        if coords and len(coords) == 2:
            fiche["lat"], fiche["lon"] = coords
        else:
            fiche["lat"], fiche["lon"] = None, None


def render_map(map_id, markers, route=False):
    """markers: liste de {titre, href, type, lat, lon}. Rien n'est rendu
    si aucun marqueur n'a de coordonnées — dégradation gracieuse, pas de
    carte vide ni cassée."""
    pins = [m for m in markers if m.get("lat") is not None and m.get("lon") is not None]
    if not pins:
        return ""

    data = json.dumps(pins, ensure_ascii=False)
    route_js = ""
    if route and len(pins) > 1:
        route_js = (
            "var route = MARKERS.map(function(m){return [m.lat, m.lon];});"
            "L.polyline(route, {className: 'route-line'}).addTo(map);"
        )

    return f"""<div class="map-embed" id="{map_id}-wrap">
  <div id="{map_id}" class="leaflet-map"></div>
  <button type="button" class="map-expand-btn" id="{map_id}-expand"
    title="Agrandir la carte" aria-label="Agrandir la carte">⤢</button>
</div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script src="../src/app.js"></script>
<script>
(function() {{
  var MARKERS = {data};
  var map = L.map('{map_id}');
  // Fonds de carte au choix (OSM, relief, satellite, clair) : voir app.js
  initBaseLayers(map);
  var bounds = [];
  MARKERS.forEach(function(m) {{
    var marker = L.marker([m.lat, m.lon]).addTo(map);
    var html = '<div class="map-popup"><strong>' + m.titre + '</strong>';
    if (m.type) {{ html += '<div class="map-popup-type">' + m.type + '</div>'; }}
    if (m.href) {{ html += '<a href="' + m.href + '">Voir la fiche →</a>'; }}
    html += '</div>';
    marker.bindPopup(html);
    bounds.push([m.lat, m.lon]);
  }});
  {route_js}
  if (bounds.length) {{ map.fitBounds(bounds, {{padding: [24, 24]}}); }}

  // Bouton agrandir/réduire : logique partagée dans app.js (initMapExpand),
  // pour rester cohérent avec le reste de l'interactif du site.
  initMapExpand(map, '{map_id}-wrap', '{map_id}-expand', function() {{ return bounds; }});
}})();
</script>"""


def render_badge(text, accent=False):
    cls = "badge accent" if accent else "badge"
    return f'<span class="{cls}">{esc(text)}</span>'


def render_tabbar(active):
    links = []
    for href, label, icon in TABS:
        cls = "active" if href == active else ""
        svg = f'<svg class="icon" width="18" height="18" viewBox="0 0 24 24">{ICONS[icon]}</svg>'
        links.append(f'<a class="{cls}" href="{href}">{svg}{esc(label)}</a>')
    return f'<nav class="tabbar">{"".join(links)}</nav>'


def page_shell(theme, kicker, title, subtitle, body_html, active_tab, include_map=False, hero="landscape", show_band=True):
    leaflet_css = (
        '<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">'
        if include_map else ""
    )
    hero_class = "hero-flag" if hero == "flag" else "hero-landscape"
    band_html = f"""<header class="band">
  <img class="coat-of-arms" src="../img/coat-of-arms.svg" alt="" aria-hidden="true">
  <div class="kicker">{esc(kicker)}</div>
  <h1>{esc(title)}</h1>
  {f'<div class="subtitle">{esc(subtitle)}</div>' if subtitle else ''}
</header>""" if show_band else ""
    return f"""<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{esc(title)} · Carnet Slovaquie</title>
<link rel="stylesheet" href="../src/style.css">
{leaflet_css}
<link rel="manifest" href="../manifest.json">
<link rel="icon" href="../icons/favicon.png">
<link rel="apple-touch-icon" href="../icons/apple-touch-icon.png">
<meta name="theme-color" content="#f2ead9">
</head>
<body data-theme="{theme}" class="{hero_class}">
{band_html}
<div class="wrap">
<main>
{body_html}
</main>
</div>
{render_tabbar(active_tab)}
<script src="../src/slovak.js"></script>
<script>
if ('serviceWorker' in navigator) {{
  navigator.serviceWorker.register('../service-worker.js');
}}
</script>
</body>
</html>
"""


def resolve_link_label(target, fiches):
    f = fiches.get(target)
    if not f:
        return f"{target} (fiche manquante)", "#"
    title = f["header"].get("titre", target)
    return title, f"{target}.html"


def render_thumb(fiche):
    """Vignette d'une fiche : sa première image si elle en a une,
    sinon un aplat de couleur avec l'initiale du titre (repli gracieux,
    pas de photo cassée)."""
    title = fiche["header"].get("titre", fiche["basename"])
    thumb = fiche.get("thumbnail")
    if thumb:
        return (
            f'<div class="card-thumb">'
            f'<img src="{esc(img_src(thumb["path"]))}" alt="{esc(thumb["caption"])}" loading="lazy">'
            f'</div>'
        )
    initial = (title.strip()[:1] or "?").upper()
    return f'<div class="card-thumb fallback" data-initial="{esc(initial)}"></div>'


def render_index_card(fiche, href, type_label):
    title = fiche["header"].get("titre", fiche["basename"])
    return (
        f'<a class="index-card" href="{href}">'
        f'{render_thumb(fiche)}'
        f'<div class="index-card-body">'
        f'<div class="type">{esc(type_label)}</div>'
        f'<div class="title">{esc(title)}</div>'
        f'</div></a>'
    )


def render_field_links(label, targets, fiches):
    pills = []
    for t in targets:
        title, href = resolve_link_label(t, fiches)
        pills.append(f'<a class="pill" href="{href}">{esc(title)}</a>')
    return f'<div class="card"><div class="label">{esc(label)}</div><div class="pill-list">{"".join(pills)}</div></div>'


# ----------------------------------------------------------------------
# Rendu d'une fiche (Lieu / Dodo / Specialite / Table / Culture)
# ----------------------------------------------------------------------

def build_badges(fiche):
    h = fiche["header"]
    family = fiche["family"]
    badges = []

    if family == "Lieu":
        fam_ok = h.get("famille-ok", "")
        if fam_ok:
            badges.append((f"famille : {fam_ok}", fam_ok == "à-éviter"))
    elif family == "Dodo":
        if h.get("confort-global"):
            badges.append((f"confort {h['confort-global']}", False))
        for v in h.get("compatible", "").split(","):
            v = v.strip()
            if v:
                badges.append((v, False))
    elif family == "Specialite":
        if h.get("catégorie"):
            badges.append((h["catégorie"], False))
        if h.get("région-origine"):
            badges.append((h["région-origine"], False))
    elif family == "Table":
        if h.get("type"):
            badges.append((h["type"], False))
        if h.get("prix"):
            badges.append((h["prix"], True))
    elif family == "Culture":
        if h.get("catégorie"):
            badges.append((h["catégorie"], False))

    for el in fiche["elements"]:
        if el["type"] != "chiffre":
            continue
        attrs = el["attrs"]
        if el["name"] == "rando":
            if "durée" in attrs:
                badges.append((attrs["durée"], True))
            if "dénivelé" in attrs:
                badges.append((f"{attrs['dénivelé']} D+", True))
            if "difficulté" in attrs:
                badges.append((attrs["difficulté"], False))
            if "balisage" in attrs:
                badges.append((f"balisage {attrs['balisage']}", False))
        elif el["name"] == "confort":
            for k, v in attrs.items():
                if v == "oui":
                    badges.append((k, False))
                elif v == "non":
                    continue
                else:
                    badges.append((f"{k} {v}", False))

    return badges


def render_body_common(fiche, fiches):
    parts = []
    info_rows = []

    def flush_info():
        if info_rows:
            rows = "".join(
                (
                    f'<p><strong>{esc(l)}</strong> — '
                    f'<a href="{esc(v)}" target="_blank" rel="noopener">{esc(v)} ↗</a></p>{speakable_html(sk)}'
                    if v.startswith(("http://", "https://"))
                    else f'<p><strong>{esc(l)}</strong> — {esc(v)}</p>{speakable_html(sk)}'
                )
                for l, v, sk in info_rows
            )
            parts.append(f'<div class="card"><div class="label">Infos pratiques</div>{rows}</div>')
            info_rows.clear()

    for el in fiche["elements"]:
        if el["type"] == "field":
            label_low = el["label"].lower()
            if label_low.startswith("notre avis"):
                flush_info()
                parts.append(
                    f'<div class="card"><div class="label">Notre avis</div><p>{esc(el["value"])}</p>'
                    f'{speakable_html(el.get("sk"))}</div>'
                )
            elif el["label"]:
                info_rows.append((el["label"], el["value"], el.get("sk")))
        elif el["type"] == "field-link":
            flush_info()
            parts.append(render_field_links(el["label"], el["targets"], fiches))
        elif el["type"] == "anecdote":
            flush_info()
            parts.append(
                f'<div class="anecdote"><div class="label">Anecdote</div><p>{esc(el["text"])}</p>'
                f'{speakable_html(el.get("sk"))}</div>'
            )
        elif el["type"] == "narrative":
            flush_info()
            heading = f'<h3 class="narrative-heading">{esc(el["label"])}</h3>' if el.get("label") else ""
            paras = "".join(f'<p>{esc(p)}</p>' for p in el["paragraphs"])
            parts.append(f'<div class="narrative">{heading}{paras}{speakable_html(el.get("sk"))}</div>')
        elif el["type"] == "image":
            flush_info()
            parts.append(
                f'<figure><img src="{esc(img_src(el["path"]))}" alt="{esc(el["caption"])}">'
                f'<figcaption>{esc(el["caption"])}</figcaption></figure>'
            )
    flush_info()
    return "".join(parts)


def flatten_etape_links(etape_fiche):
    """Liste ordonnée des fiches liées dans une Étape, jours confondus —
    sert de base à la navigation précédent/suivant."""
    return [el["target"] for el in etape_fiche["elements"] if el["type"] == "link"]


def load_etapes_order():
    order_file = MD_DIR / "etapes.txt"
    return [l.strip() for l in order_file.read_text(encoding="utf-8").splitlines() if l.strip()]


def render_nav_pair(prev_item, next_item):
    """prev_item / next_item : (titre, href) ou None."""
    if not prev_item and not next_item:
        return ""
    prev_html = (
        f'<a class="nav-link prev" href="{prev_item[1]}">'
        f'<span class="arrow">←</span><span>{esc(prev_item[0])}</span></a>'
        if prev_item else '<span class="nav-link empty"></span>'
    )
    next_html = (
        f'<a class="nav-link next" href="{next_item[1]}">'
        f'<span>{esc(next_item[0])}</span><span class="arrow">→</span></a>'
        if next_item else '<span class="nav-link empty"></span>'
    )
    return f'<div class="fiche-nav">{prev_html}{next_html}</div>'


def kicker_for(fiche):
    h = fiche["header"]
    family = fiche["family"]
    if family == "Lieu":
        return " · ".join(x for x in [h.get("type", ""), h.get("région", "")] if x)
    if family == "Dodo":
        return " · ".join(x for x in [h.get("type", ""), h.get("région", "")] if x)
    if family == "Specialite":
        return " · ".join(x for x in [h.get("catégorie", ""), h.get("région-origine", "")] if x)
    if family == "Table":
        return " · ".join(x for x in [h.get("type", ""), h.get("région", "")] if x)
    if family == "Culture":
        return " · ".join(x for x in [h.get("catégorie", ""), h.get("région", "")] if x)
    return family


def render_episode_nav(fiche, fiches):
    """Navigation précédent/suivant pour les fiches Culture histoire,
    dérivée des champs `+ épisode précédent/suivant -> ...` de la fiche —
    indépendante du mécanisme utilisé pour les jours d'étape. Réutilise
    render_nav_pair pour rester visuellement cohérent avec le reste du
    site. Aucun champ présent -> chaîne vide, comme toujours."""
    prev_item = None
    next_item = None
    for el in fiche["elements"]:
        if el["type"] != "field-link" or not el["targets"]:
            continue
        label = el["label"].lower()
        if label == "épisode précédent":
            prev_item = resolve_link_label(el["targets"][0], fiches)
        elif label == "épisode suivant":
            next_item = resolve_link_label(el["targets"][0], fiches)
    return render_nav_pair(prev_item, next_item)


def render_fiche_page(fiche, fiches, fiche_context, etape_compositions):
    h = fiche["header"]
    theme = slugify(h.get("région", ""))
    title = h.get("titre", fiche["basename"])
    catégorie = h.get("catégorie", "").strip().lower()
    is_pays_fiche = fiche["family"] == "Culture" and catégorie in PAYS_CATEGORIES

    # Pour les fiches histoire, la période (ex. "1989–2009") est un
    # repère de navigation plus utile en kicker que le libellé générique.
    kicker = h.get("période") if catégorie == "histoire" and h.get("période") else kicker_for(fiche)

    # Contenu écrit à la main dans pages/fiches/<basename>.html, s'il
    # existe -> remplace le rendu générique des blocs TMD. La fiche .md
    # reste la seule source de vérité pour le titre, la période, le tri
    # chronologique et les liens épisode précédent/suivant : rien de tout
    # ça n'est dupliqué dans le HTML statique.
    static_body = read_static_fragment(f'fiches/{fiche["basename"]}.html')
    if static_body:
        body_html = static_body
    else:
        badges = build_badges(fiche)
        badges_html = ""
        if badges:
            spans = "".join(render_badge(t, a) for t, a in badges)
            badges_html = f'<div class="badge-row">{spans}</div>'
        body_html = badges_html + render_body_common(fiche, fiches)

    body_html += render_episode_nav(fiche, fiches)

    # Navigation précédent/suivant : dérivée de l'étape qui référence cette
    # fiche en premier dans etapes.txt. Si une fiche est reliée par
    # plusieurs étapes, seule la première rencontrée pilote la nav ici —
    # limite connue du proto, sans conséquence sur le contenu.
    ctx = fiche_context.get(fiche["basename"])
    if ctx:
        etape_name, idx = ctx
        comp = etape_compositions.get(etape_name, [])
        etape_fiche = fiches.get(etape_name)
        back_html = ""
        if etape_fiche:
            back_html = (
                f'<a class="back-link" href="{etape_name}.html">'
                f'← retour à l\'étape {esc(etape_fiche["header"].get("titre", etape_name))}</a>'
            )
        prev_item = None
        next_item = None
        if idx > 0:
            prev_f = fiches.get(comp[idx - 1])
            if prev_f:
                prev_item = (prev_f["header"].get("titre", comp[idx - 1]), f'{comp[idx - 1]}.html')
        if idx < len(comp) - 1:
            next_f = fiches.get(comp[idx + 1])
            if next_f:
                next_item = (next_f["header"].get("titre", comp[idx + 1]), f'{comp[idx + 1]}.html')
        body_html += back_html + render_nav_pair(prev_item, next_item)

    active_tab = "pays.html" if is_pays_fiche else "bibliotheque.html"
    return page_shell(theme, kicker, title, None, body_html, active_tab=active_tab)



# ----------------------------------------------------------------------
# Rendu d'une fiche Étape (chapitre)
# ----------------------------------------------------------------------

def render_etape_page(fiche, fiches, etape_order):
    h = fiche["header"]
    theme = slugify(h.get("région", ""))
    title = h.get("titre", fiche["basename"])
    nuits = h.get("nuits", "")
    kicker = f"Étape · {nuits} nuit(s)" if nuits else "Étape"

    trajet_attrs = {}
    for el in fiche["elements"]:
        pass
    trajet_raw = h.get("trajet-depuis-précédente", "")
    subtitle = None
    if trajet_raw:
        attrs = parse_attrs(trajet_raw)
        bits = []
        if attrs.get("étape"):
            bits.append(f"depuis {attrs['étape']}")
        if attrs.get("distance"):
            bits.append(attrs["distance"])
        if attrs.get("durée"):
            bits.append(attrs["durée"])
        subtitle = "trajet : " + " · ".join(bits)

    parts = []
    current_day = None
    day_buffer = []
    info_rows = []
    lieu_markers = []
    # Dodo et Table sortent du fil des jours : rendus à part, en fin de
    # fiche Étape, peu importe où ils apparaissent dans le fichier source.
    dodo_cards = []
    table_cards = []

    def flush_day():
        if day_buffer:
            cards = f'<div class="index-grid">{"".join(day_buffer)}</div>'
            if current_day:
                parts.append(f'<div class="day-group"><h3>{esc(current_day)}</h3>{cards}</div>')
            else:
                parts.append(cards)
            day_buffer.clear()

    def flush_info():
        if info_rows:
            rows = "".join(
                (
                    f'<p><strong>{esc(l)}</strong> — '
                    f'<a href="{esc(v)}" target="_blank" rel="noopener">{esc(v)} ↗</a></p>{speakable_html(sk)}'
                    if v.startswith(("http://", "https://"))
                    else f'<p><strong>{esc(l)}</strong> — {esc(v)}</p>{speakable_html(sk)}'
                )
                for l, v, sk in info_rows
            )
            parts.append(f'<div class="card"><div class="label">Infos pratiques</div>{rows}</div>')
            info_rows.clear()

    for el in fiche["elements"]:
        if el["type"] == "field" and el["label"].lower().startswith("intro"):
            parts.append(
                f'<div class="card"><div class="label">Ambiance</div><p>{esc(el["value"])}</p>'
                f'{speakable_html(el.get("sk"))}</div>'
            )
        elif el["type"] == "field" and el["label"]:
            info_rows.append((el["label"], el["value"], el.get("sk")))
        elif el["type"] == "field-link":
            flush_info()
            parts.append(render_field_links(el["label"], el["targets"], fiches))
        elif el["type"] == "image":
            flush_info()
            parts.append(
                f'<figure><img src="{esc(img_src(el["path"]))}" alt="{esc(el["caption"])}">'
                f'<figcaption>{esc(el["caption"])}</figcaption></figure>'
            )
        elif el["type"] == "day":
            flush_info()
            flush_day()
            current_day = el["label"]
        elif el["type"] == "link":
            flush_info()
            target_fiche = fiches.get(el["target"])
            if target_fiche and target_fiche["family"] == "Dodo":
                dodo_cards.append(render_index_card(target_fiche, f'{el["target"]}.html', "Dodo"))
            elif target_fiche and target_fiche["family"] == "Table":
                table_cards.append(render_index_card(target_fiche, f'{el["target"]}.html', "Table"))
            elif target_fiche:
                day_buffer.append(
                    render_index_card(target_fiche, f'{el["target"]}.html', target_fiche["family"])
                )
                if target_fiche["family"] == "Lieu":
                    lieu_markers.append({
                        "titre": target_fiche["header"].get("titre", el["target"]),
                        "href": f'{el["target"]}.html',
                        "type": target_fiche["header"].get("type", ""),
                        "lat": target_fiche.get("lat"),
                        "lon": target_fiche.get("lon"),
                    })
            else:
                day_buffer.append(
                    f'<a class="index-card" href="#">'
                    f'<div class="card-thumb fallback" data-initial="?"></div>'
                    f'<div class="index-card-body"><div class="type">fiche manquante</div>'
                    f'<div class="title">{esc(el["target"])}</div></div></a>'
                )
        elif el["type"] == "anecdote":
            flush_info()
            flush_day()
            parts.append(
                f'<div class="anecdote"><div class="label">Anecdote</div><p>{esc(el["text"])}</p>'
                f'{speakable_html(el.get("sk"))}</div>'
            )
        elif el["type"] == "narrative":
            flush_info()
            flush_day()
            heading = f'<h3 class="narrative-heading">{esc(el["label"])}</h3>' if el.get("label") else ""
            paras = "".join(f'<p>{esc(p)}</p>' for p in el["paragraphs"])
            parts.append(f'<div class="narrative">{heading}{paras}{speakable_html(el.get("sk"))}</div>')

    flush_info()
    flush_day()

    map_html = render_map(f'map-{fiche["basename"]}', lieu_markers)

    if dodo_cards:
        parts.append(
            f'<div class="index-section"><h2>Où dormir</h2>'
            f'<div class="index-grid">{"".join(dodo_cards)}</div></div>'
        )
    if table_cards:
        parts.append(
            f'<div class="index-section"><h2>Où manger</h2>'
            f'<div class="index-grid">{"".join(table_cards)}</div></div>'
        )

    body_html = map_html + "".join(parts)

    if fiche["basename"] in etape_order:
        pos = etape_order.index(fiche["basename"])
        prev_item = None
        next_item = None
        if pos > 0:
            prev_f = fiches.get(etape_order[pos - 1])
            if prev_f:
                prev_item = (prev_f["header"].get("titre", etape_order[pos - 1]), f'{etape_order[pos - 1]}.html')
        if pos < len(etape_order) - 1:
            next_f = fiches.get(etape_order[pos + 1])
            if next_f:
                next_item = (next_f["header"].get("titre", etape_order[pos + 1]), f'{etape_order[pos + 1]}.html')
        body_html += render_nav_pair(prev_item, next_item)

    return page_shell(
        theme, kicker, title, subtitle, body_html,
        active_tab="carnet.html", include_map=bool(map_html),
    )


# ----------------------------------------------------------------------
# Vue Carnet (chapitres dans l'ordre décidé)
# ----------------------------------------------------------------------

def build_etape_markers(fiches, etape_order):
    """Marqueurs de carte pour les étapes du voyage, dans l'ordre de
    etapes.txt — factorisé pour être réutilisé identique par le Carnet
    et par la mini-carte de la page Pays."""
    markers = []
    for i, name in enumerate(etape_order, start=1):
        f = fiches.get(name)
        if not f:
            continue
        h = f["header"]
        markers.append({
            "titre": f'{i}. {h.get("titre", name)}',
            "href": f"{name}.html",
            "type": f'{h.get("nuits", "?")} nuits',
            "lat": f.get("lat"),
            "lon": f.get("lon"),
        })
    return markers


def render_carnet(fiches, etape_order):
    cards = []
    for i, name in enumerate(etape_order, start=1):
        f = fiches.get(name)
        if not f:
            continue
        h = f["header"]
        cards.append(render_index_card(f, f"{name}.html", f'Étape {i} · {h.get("nuits", "?")} nuits'))

    markers = build_etape_markers(fiches, etape_order)
    map_html = render_map("map-carnet", markers, route=True)
    body = (
        map_html
        + f'<div class="index-section"><h2>Votre voyage</h2><div class="index-grid">{"".join(cards)}</div></div>'
        + '<p style="text-align:right;margin-top:4px;font-size:12px;color:var(--ink-soft);">'
        + '🛠 <a href="admin.html" style="color:inherit;">Organiser (desktop)</a> · '
        + '<a href="admin2.html" style="color:inherit;">Organiser (mobile)</a></p>'
    )
    return page_shell("", "Vue d'ensemble", "Carnet", None, body, active_tab="carnet.html", include_map=bool(map_html), hero="flag")


# ----------------------------------------------------------------------
# Vue Pays (intro + géographie + histoire, à partir des fiches Culture)
# ----------------------------------------------------------------------

# Catégories Culture qui vivent sur la page Pays plutôt qu'en Brouillon —
# elles ne sont jamais candidates à une étape, donc pas leur place dans
# le tri "étapes-candidates".
PAYS_CATEGORIES = {"intro", "géographie", "histoire"}


def periode_sort_key(fiche, fallback_index):
    """Trie sur le premier nombre à 3-4 chiffres trouvé dans le champ
    "période" (ex. "1918", "1938–1945", "833"). Rien de repérable ->
    la fiche part en fin de liste, dans son ordre naturel — jamais
    d'erreur pour une période absente ou mal formée."""
    raw = fiche["header"].get("période", "")
    m = re.search(r"\b\d{3,4}\b", raw)
    return (0, int(m.group())) if m else (1, fallback_index)


def render_pays(fiches, etape_order):
    culture = [f for f in fiches.values() if f["family"] == "Culture"]

    def by_categorie(cat):
        return [f for f in culture if f["header"].get("catégorie", "").strip().lower() == cat]

    geo_fiches = by_categorie("géographie")
    histoire_fiches = by_categorie("histoire")
    histoire_fiches = [
        f for _, f in sorted(enumerate(histoire_fiches), key=lambda p: periode_sort_key(p[1], p[0]))
    ]

    # Le bandeau "intro" est écrit à la main dans pages/pays-intro.html —
    # contenu éditorial figé, sans intérêt à repasser par le moteur TMD.
    # Sa présence pilote aussi le bandeau vert standard : hero plein écran
    # immersif si le fragment existe, bandeau habituel sinon.
    intro_html = read_static_fragment("pays-intro.html")
    map_html = ""
    if intro_html:
        markers = build_etape_markers(fiches, etape_order)
        map_html = render_map("map-pays", markers, route=True)
        intro_html = intro_html.replace("<!-- CARTE_ITINERAIRE -->", map_html)

    parts = [intro_html] if intro_html else []

    if geo_fiches:
        cards = [render_index_card(f, f'{f["basename"]}.html', "Géographie") for f in geo_fiches]
        parts.append(
            f'<div class="index-section"><h2>Géographie</h2>'
            f'<div class="index-grid">{"".join(cards)}</div></div>'
        )

    if histoire_fiches:
        cards = [
            render_index_card(f, f'{f["basename"]}.html', f["header"].get("période", "Histoire"))
            for f in histoire_fiches
        ]
        parts.append(
            f'<div class="index-section"><h2>Histoire</h2>'
            f'<div class="index-grid">{"".join(cards)}</div></div>'
        )

    if not parts:
        parts.append(
            '<p class="empty">Rien à afficher pour le moment — ajoute une fiche Culture '
            'avec catégorie: géographie ou histoire, ou un fragment pages/pays-intro.html.</p>'
        )

    body = "".join(parts)
    return page_shell(
        "", "Le pays", "Pays", None, body, active_tab="pays.html",
        show_band=not intro_html, include_map=bool(map_html),
    )


# ----------------------------------------------------------------------
# Vue Bibliothèque (toutes les fiches, groupées par famille)
# ----------------------------------------------------------------------

FAMILY_LABELS = {
    "Lieu": "Lieux & randos",
    "Dodo": "Dodo",
    "Specialite": "Spécialités",
    "Table": "Table",
    "Culture": "Culture & bizarreries",
    "Etape": "Étapes",
}


def render_bibliotheque(fiches):
    sections = []
    for fam in FAMILIES:
        items = [f for f in fiches.values() if f["family"] == fam]
        if not items:
            continue
        items.sort(key=lambda f: f["header"].get("titre", f["basename"]))
        cards = [render_index_card(f, f'{f["basename"]}.html', kicker_for(f)) for f in items]
        sections.append(
            f'<div class="index-section"><h2>{esc(FAMILY_LABELS.get(fam, fam))}</h2>'
            f'<div class="index-grid">{"".join(cards)}</div></div>'
        )

    body = "".join(sections)
    return page_shell("", "Toutes les fiches", "Bibliothèque", None, body, active_tab="bibliotheque.html")


# ----------------------------------------------------------------------
# Vue Brouillon (tri par étapes-candidates)
# ----------------------------------------------------------------------

def render_brouillon(fiches):
    groups = {}
    unclassified = []

    for f in fiches.values():
        if f["family"] not in ("Lieu", "Culture"):
            continue
        if f["family"] == "Culture" and f["header"].get("catégorie", "").strip().lower() in PAYS_CATEGORIES:
            continue
        candidates = f["header"].get("étapes-candidates", "")
        cands = [c.strip() for c in candidates.split(",") if c.strip()]
        if not cands:
            unclassified.append(f)
        for c in cands:
            groups.setdefault(c, []).append(f)

    sections = []
    for name in sorted(groups):
        cards = [render_index_card(f, f'{f["basename"]}.html', kicker_for(f)) for f in groups[name]]
        sections.append(
            f'<div class="index-section"><h2>{esc(name)}</h2>'
            f'<div class="index-grid">{"".join(cards)}</div></div>'
        )

    if unclassified:
        cards = [render_index_card(f, f'{f["basename"]}.html', kicker_for(f)) for f in unclassified]
        sections.append(
            f'<div class="index-section"><h2>En réflexion</h2>'
            f'<div class="index-grid">{"".join(cards)}</div></div>'
        )

    if not sections:
        sections.append('<p class="empty">Aucune fiche candidate pour le moment.</p>')

    body = "".join(sections)
    return page_shell("", "Avant de trancher", "Brouillon", None, body, active_tab="brouillon.html")


# ----------------------------------------------------------------------
# Vue Pratique (checklist + budget, état géré en JS/localStorage)
# ----------------------------------------------------------------------

def render_pratique():
    body = """
<div class="index-section">
  <h2>Checklist</h2>
  <div class="card" id="checklist-card">
    <p class="empty">Chargement…</p>
  </div>
</div>
<div class="index-section">
  <h2>Budget</h2>
  <div class="card" id="budget-card">
    <p class="empty">Chargement…</p>
  </div>
</div>
<div class="index-section">
  <h2>Réglages</h2>
  <div class="card" id="tts-speed-card">
    <p class="empty">Chargement…</p>
  </div>
</div>
<script src="../src/app.js"></script>
"""
    return page_shell("", "Avant / pendant le voyage", "Pratique", None, body, active_tab="pratique.html")


# ----------------------------------------------------------------------
# Admin : organiser les fiches en étapes (Kanban + carte filtrée + export)
# ----------------------------------------------------------------------

ADMIN_ASSIGNABLE_FAMILIES = ("Lieu", "Dodo", "Table", "Culture")


def build_admin_data(fiches, etape_order, etape_compositions):
    fiches_data = {}
    for basename, f in fiches.items():
        if f["family"] not in ADMIN_ASSIGNABLE_FAMILIES:
            continue
        h = f["header"]
        candidates = [c.strip() for c in h.get("étapes-candidates", "").split(",") if c.strip()]
        fiches_data[basename] = {
            "family": f["family"],
            "titre": h.get("titre", basename),
            "region": h.get("région", ""),
            "type": h.get("type", ""),
            "candidates": candidates,
            "lat": f.get("lat"),
            "lon": f.get("lon"),
        }

    etapes_data = []
    compositions = {}
    for name in etape_order:
        f = fiches.get(name)
        if not f:
            continue
        h = f["header"]
        etapes_data.append({"basename": name, "titre": h.get("titre", name), "nuits": h.get("nuits", "")})
        compositions[name] = [b for b in etape_compositions.get(name, []) if b in fiches_data]

    return {"fiches": fiches_data, "etapes": etapes_data, "compositions": compositions}


def render_admin(fiches, etape_order, etape_compositions):
    data_json = json.dumps(build_admin_data(fiches, etape_order, etape_compositions), ensure_ascii=False)

    body = """
<div class="admin-tabs">
  <button class="admin-tab active" data-tab="etapes">Étapes</button>
  <button class="admin-tab" data-tab="carte">Carte</button>
  <button class="admin-tab" data-tab="export">Export</button>
  <button id="reset-btn" class="btn-copy" style="margin-left:auto;">Réinitialiser depuis les fichiers</button>
</div>

<div id="panel-etapes" class="admin-panel active">
  <p class="admin-hint">Glisse une fiche d'une colonne à l'autre pour l'affecter à une étape. Les flèches réordonnent les étapes elles-mêmes.</p>
  <div id="kanban-board" class="kanban-board"></div>
</div>

<div id="panel-carte" class="admin-panel">
  <div class="filters-bar">
    <input id="filter-search" type="search" placeholder="Rechercher…">
    <select id="filter-region"><option value="">Toutes les régions</option></select>
    <select id="filter-status">
      <option value="">Tous statuts</option>
      <option value="assigne">Assigné</option>
      <option value="candidat">Candidat</option>
      <option value="nonclasse">Non classé</option>
    </select>
  </div>
  <div id="admin-map"></div>
</div>

<div id="panel-export" class="admin-panel">
  <p class="admin-hint">Recopie chaque bloc dans le fichier source correspondant, puis relance <code>python3 src/tmd2html.py</code>.</p>
  <div id="export-content"></div>
</div>
"""

    return f"""<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Admin · Carnet Slovaquie</title>
<link rel="stylesheet" href="../src/style.css">
<link rel="stylesheet" href="../src/admin.css">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
</head>
<body data-theme="" class="admin-page">
<header class="band">
  <div class="kicker">Outil de préparation · desktop</div>
  <h1>Admin</h1>
  <div class="subtitle">Organiser les fiches en étapes, avant export vers les fichiers sources</div>
</header>
<div class="wrap">
<main>
{body}
</main>
</div>
<script>window.ADMIN_DATA = {data_json};</script>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script src="../src/admin-core.js"></script>
<script src="../src/admin.js"></script>
</body>
</html>
"""


def render_admin2(fiches, etape_order, etape_compositions):
    data_json = json.dumps(build_admin_data(fiches, etape_order, etape_compositions), ensure_ascii=False)

    body = """
<div class="admin-tabs">
  <button class="admin-tab active" data-tab="etapes">Étapes</button>
  <button class="admin-tab" data-tab="carte">Carte</button>
  <button class="admin-tab" data-tab="export">Export</button>
</div>

<div id="panel-etapes" class="admin-panel active">
  <div class="admin-mobile-section">
    <h2>Ordre des étapes</h2>
    <div id="etape-order-list" class="etape-order-list"></div>
  </div>
  <div class="admin-mobile-section">
    <h2>Fiches</h2>
    <select id="group-select"></select>
    <div id="mobile-card-list"></div>
  </div>
  <button id="reset-btn" class="btn-copy">Réinitialiser depuis les fichiers</button>
</div>

<div id="panel-carte" class="admin-panel">
  <div class="filters-bar">
    <input id="filter-search" type="search" placeholder="Rechercher…">
    <select id="filter-region"><option value="">Toutes les régions</option></select>
    <select id="filter-status">
      <option value="">Tous statuts</option>
      <option value="assigne">Assigné</option>
      <option value="candidat">Candidat</option>
      <option value="nonclasse">Non classé</option>
    </select>
  </div>
  <div id="admin-map"></div>
</div>

<div id="panel-export" class="admin-panel">
  <p class="admin-hint">Copie chaque bloc, colle-le dans le fichier source correspondant sur ton PC, puis relance <code>python3 src/tmd2html.py</code>.</p>
  <div id="export-content"></div>
</div>
"""

    return f"""<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Admin mobile · Carnet Slovaquie</title>
<link rel="stylesheet" href="../src/style.css">
<link rel="stylesheet" href="../src/admin.css">
<link rel="stylesheet" href="../src/admin-mobile.css">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
</head>
<body data-theme="">
<header class="band">
  <div class="kicker">Outil de préparation · mobile</div>
  <h1>Admin</h1>
  <div class="subtitle">Même brouillon que la version desktop</div>
</header>
<div class="wrap">
<main>
{body}
</main>
</div>
<script>window.ADMIN_DATA = {data_json};</script>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script src="../src/admin-core.js"></script>
<script src="../src/admin2.js"></script>
</body>
</html>
"""


# ----------------------------------------------------------------------
# Orchestration
# ----------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    add_data_argument(parser)
    args = parser.parse_args()
    set_data_dir(args.data)

    HTML_DIR.mkdir(exist_ok=True)
    fiches = load_all_fiches()
    etape_order = load_etapes_order()

    geocache = load_geocache()
    attach_coordinates(fiches, geocache)
    if not geocache:
        print(
            "Info : aucun geocache.json trouvé — les cartes Leaflet resteront "
            "invisibles tant que `python3 src/geocode.py` n'a pas été lancé."
        )

    # Composition à plat de chaque étape (jours confondus) +, pour chaque
    # fiche référencée, l'étape qui pilote sa nav précédent/suivant
    # (la première qui la référence, dans l'ordre du voyage).
    etape_compositions = {
        name: flatten_etape_links(fiches[name]) for name in etape_order if name in fiches
    }
    fiche_context = {}
    for name in etape_order:
        for idx, target in enumerate(etape_compositions.get(name, [])):
            fiche_context.setdefault(target, (name, idx))

    for basename, f in fiches.items():
        if f["family"] == "Etape":
            html = render_etape_page(f, fiches, etape_order)
        else:
            html = render_fiche_page(f, fiches, fiche_context, etape_compositions)
        (HTML_DIR / f"{basename}.html").write_text(html, encoding="utf-8")

    carnet_html = render_carnet(fiches, etape_order)
    (HTML_DIR / "carnet.html").write_text(carnet_html, encoding="utf-8")
    (HTML_DIR / "pays.html").write_text(render_pays(fiches, etape_order), encoding="utf-8")
    (HTML_DIR / "bibliotheque.html").write_text(render_bibliotheque(fiches), encoding="utf-8")
    (HTML_DIR / "brouillon.html").write_text(render_brouillon(fiches), encoding="utf-8")
    (HTML_DIR / "pratique.html").write_text(render_pratique(), encoding="utf-8")
    (HTML_DIR / "admin.html").write_text(render_admin(fiches, etape_order, etape_compositions), encoding="utf-8")
    (HTML_DIR / "admin2.html").write_text(render_admin2(fiches, etape_order, etape_compositions), encoding="utf-8")
    (HTML_DIR / "index.html").write_text(carnet_html, encoding="utf-8")

    print(f"{len(fiches)} fiches converties -> {HTML_DIR}")


if __name__ == "__main__":
    main()
