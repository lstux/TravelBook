#!/usr/bin/env python3
"""
fetch_images.py — repère les fiches sans image, cherche une illustration
sur Wikimedia Commons, la télécharge dans img/ et met à jour la fiche
(ajoute la ligne `@ img/fichier.jpg | légende`).

Usage :
    python3 src/fetch_images.py                 traite les fiches sans image
    python3 src/fetch_images.py --list           liste sans requêter le réseau
    python3 src/fetch_images.py --pause 1.5      espace davantage les requêtes
    python3 src/fetch_images.py --retry-failed   retente les échecs mémorisés
    python3 src/fetch_images.py --interactive    reprend les échecs un par un,
                                                  avec choix numéroté, recherche
                                                  libre ou URL collée à la main

Important — ce script ne touche JAMAIS une fiche qui a déjà une image
(qu'elle vienne de ce script ou d'une image posée à la main) : pour la
remplacer, retire d'abord la ligne `@ ...` de la fiche toi-même. `--force`
et `--retry-failed` ne concernent que les échecs mémorisés, jamais les
succès déjà acquis — pas de mauvaise surprise sur une image que tu as
choisie exprès.

Comme geocode.py : une seule pause après CHAQUE requête réseau (succès ou
échec), le cache des échecs se sauvegarde en continu (un Ctrl+C ne perd
rien), et un rapport `img-a-completer.md` récapitule ce qui reste, avec
des liens de recherche prêts à l'emploi.

Pour illustrer une fiche à la main plutôt que d'attendre le script,
ajoute directement dans le corps :
    @ img/monfichier.jpg | Ma légende
ou une URL directe (hotlink, pas de téléchargement) :
    @ https://commons.wikimedia.org/wiki/Special:FilePath/Fichier.jpg | Légende
"""

import argparse
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import tmd2html  # noqa: E402
from tmd2html import load_all_fiches, HEADER_LINE, set_data_dir, add_data_argument  # noqa: E402

DATA = IMG_DIR = CACHE_PATH = REPORT_PATH = None   # fixés par configure()


def configure(value=None):
    global DATA, IMG_DIR, CACHE_PATH, REPORT_PATH
    DATA = set_data_dir(value)
    IMG_DIR = DATA / "img"
    CACHE_PATH = DATA / "imgcache.json"      # ne mémorise QUE les échecs (basename -> null)
    REPORT_PATH = DATA / "img-a-completer.md"


configure()

USER_AGENT = "carnet-slovaquie/1.0 (usage personnel, sans contact public)"
COMMONS_API = "https://commons.wikimedia.org/w/api.php"
DEFAULT_PAUSE = 1.0

# Familles où une vignette a un usage réel (index-cards, chapitres...).
# Specialite n'y est pas : pas de vignette dédiée dans le système actuel.
IMAGEABLE_FAMILIES = ("Lieu", "Dodo", "Table", "Culture", "Etape")

GOOD_EXTENSIONS = (".jpg", ".jpeg", ".png")
SKIP_WORDS = ("icon", "logo", "flag of", "coat of arms", "map of", "diagram", "symbol", "disambig")


# ==========================================================================
# Cache des échecs (même logique que geocode.py)
# ==========================================================================

def load_cache():
    if not CACHE_PATH.exists():
        return {}
    return json.loads(CACHE_PATH.read_text(encoding="utf-8"))


def save_cache(cache):
    CACHE_PATH.write_text(
        json.dumps(cache, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def has_image(fiche):
    return any(el["type"] == "image" for el in fiche["elements"])


# ==========================================================================
# Wikimedia Commons : recherche + métadonnées + téléchargement
# ==========================================================================

def api_call(params, pause):
    url = f"{COMMONS_API}?{urllib.parse.urlencode(params)}"
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            data = json.load(response)
        time.sleep(pause)
        return data, None
    except Exception as exc:
        time.sleep(pause)
        return None, str(exc)


def commons_search(query, pause, limit=6):
    data, err = api_call({
        "action": "query", "list": "search", "srnamespace": "6",
        "srlimit": str(limit), "format": "json", "srsearch": query,
    }, pause)
    if err or not data:
        return [], err
    results = data.get("query", {}).get("search", [])
    titles = [r["title"] for r in results if r["title"].lower().endswith(GOOD_EXTENSIONS)]
    return titles, None


def commons_imageinfo(titles, pause):
    if not titles:
        return {}
    data, err = api_call({
        "action": "query", "titles": "|".join(titles), "prop": "imageinfo",
        "iiprop": "url|size", "iiurlwidth": "1600", "format": "json",
    }, pause)
    if err or not data:
        return {}
    pages = data.get("query", {}).get("pages", {})
    info = {}
    for page in pages.values():
        title = page.get("title")
        ii = page.get("imageinfo")
        if title and ii:
            info[title] = ii[0]
    return info


def search_and_fetch(query, pause):
    """Retourne (candidats, erreur). candidats = liste de
    {title, url, thumburl, width, height}, meilleur résultat en premier."""
    titles, err = commons_search(query, pause)
    if err:
        return [], err
    titles = [t for t in titles if not any(w in t.lower() for w in SKIP_WORDS)]
    if not titles:
        return [], None
    info = commons_imageinfo(titles, pause)
    candidates = []
    for t in titles:
        ii = info.get(t)
        if not ii:
            continue
        candidates.append({
            "title": t,
            "url": ii.get("url"),
            "thumburl": ii.get("thumburl"),
            "width": ii.get("thumbwidth") or ii.get("width"),
            "height": ii.get("thumbheight") or ii.get("height"),
        })
    return candidates, None


def ext_from_url(url):
    path = urllib.parse.urlparse(url).path
    ext = Path(path).suffix.lower()
    return ext if ext in GOOD_EXTENSIONS else ".jpg"


def download_image(url, dest_path, pause):
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            data = response.read()
        dest_path.parent.mkdir(parents=True, exist_ok=True)
        dest_path.write_bytes(data)
        time.sleep(pause)
        return True, None
    except Exception as exc:
        time.sleep(pause)
        return False, str(exc)


def search_links(titre, région):
    q = urllib.parse.quote(f"{titre} {région}".strip())
    q_full = urllib.parse.quote(f"{titre} {région} Slovaquie".strip())
    return {
        "commons": f"https://commons.wikimedia.org/w/index.php?search={q}&title=Special:MediaSearch&type=image",
        "gimages": f"https://www.google.com/search?tbm=isch&q={q_full}",
    }


# ==========================================================================
# Édition de la fiche : insertion de la ligne @ juste après l'en-tête
# ==========================================================================

def insert_image_line(path, img_line):
    text = path.read_text(encoding="utf-8")
    lines = text.split("\n")
    end = len(lines)
    for i, raw in enumerate(lines):
        stripped = raw.strip()
        if not stripped:
            end = i
            break
        if not HEADER_LINE.match(stripped) or stripped.startswith(("#", "+", "!", "@", "->", "==")):
            end = i
            break

    if end < len(lines) and lines[end].strip() == "":
        insert_at = end + 1
        new_lines = lines[:insert_at] + [img_line, ""] + lines[insert_at:]
    else:
        new_lines = lines[:end] + ["", img_line, ""] + lines[end:]

    path.write_text("\n".join(new_lines), encoding="utf-8")


# ==========================================================================
# Mode interactif
# ==========================================================================

def print_candidates(options):
    for i, c in enumerate(options, start=1):
        dims = f"  {c['width']}×{c['height']}" if c.get("width") else ""
        print(f"  {i}) {c['title']}{dims}")


def interactive_resolve(unresolved, cache, pause):
    """unresolved : liste de (basename, path, titre, région, candidats_déjà_tentés).
    Retourne (résolues_maintenant, toujours_non_résolues)."""
    still_unresolved = []
    resolved_count = 0
    total = len(unresolved)
    idx = 0

    print(f"\n--- Mode interactif : {total} fiche(s) sans image ---\n")

    try:
        for idx, (basename, path, titre, région, candidates) in enumerate(unresolved, start=1):
            print(f"[{idx}/{total}] # {titre}" + (f"  ({région})" if région else "") + f"  [{basename}]")
            options = list(candidates)
            if options:
                print_candidates(options)
            else:
                print("  (aucun résultat automatique)")
            links = search_links(titre, région)
            print(f"  Chercher ailleurs : {links['commons']}")
            print(f"                      {links['gimages']}")
            print("  0) passer cette fiche")
            print("  (numéro, nouvelle recherche Commons, ou URL d'image collée directement)")

            while True:
                try:
                    choice = input("> ").strip()
                except EOFError:
                    print("\n(pas d'entrée interactive disponible — le reste part en rapport à compléter à la main.)")
                    still_unresolved.append((basename, titre, région))
                    for remaining in unresolved[idx:]:
                        still_unresolved.append(remaining[:3])
                    return resolved_count, still_unresolved

                if choice == "0" or choice.lower() in ("s", "skip"):
                    still_unresolved.append((basename, titre, région))
                    break

                if choice.isdigit() and options and 1 <= int(choice) <= len(options):
                    chosen = options[int(choice) - 1]
                    url = chosen.get("thumburl") or chosen.get("url")
                elif choice.startswith("http"):
                    url = choice
                elif choice:
                    print(f"  Recherche : {choice} ...", end=" ", flush=True)
                    new_candidates, err = search_and_fetch(choice, pause)
                    if err:
                        print(f"erreur ({err}). Réessaie.")
                        continue
                    if not new_candidates:
                        print("aucun résultat. Réessaie.")
                        continue
                    print(f"{len(new_candidates)} résultat(s)")
                    options = new_candidates
                    print_candidates(options)
                    continue
                else:
                    print("Entrée vide — un numéro, une recherche, une URL, ou 0 pour passer.")
                    continue

                dest = IMG_DIR / f"{basename}{ext_from_url(url)}"
                print("  Téléchargement...", end=" ", flush=True)
                ok, err = download_image(url, dest, pause)
                if not ok:
                    print(f"échec ({err}). Réessaie.")
                    continue

                insert_image_line(path, f"@ img/{dest.name} | {titre}")
                cache.pop(basename, None)  # efface un éventuel échec mémorisé
                save_cache(cache)
                print(f"OK -> img/{dest.name}")
                resolved_count += 1
                break

            print()
    except KeyboardInterrupt:
        print("\n\nInterrompu — ce qui a déjà été téléchargé reste en place.")
        seen = {b for b, _, _ in still_unresolved}
        for basename, _path, titre, région, _candidates in unresolved[idx - 1:]:
            if basename not in seen:
                still_unresolved.append((basename, titre, région))
                seen.add(basename)

    return resolved_count, still_unresolved


# ==========================================================================
# Rapport
# ==========================================================================

def write_report(items):
    if not items:
        if REPORT_PATH.exists():
            REPORT_PATH.unlink()
        return

    lines = [
        "# Images à compléter à la main",
        "",
        f"{len(items)} fiche(s) sans image trouvée automatiquement. Pour chacune :",
        "1. Ouvre un des liens de recherche ci-dessous.",
        "2. Trouve une image qui te plaît (droits libres de préférence : Wikimedia Commons).",
        "3. Colle l'URL directe de l'image (ou télécharge-la dans `img/`) dans la fiche :",
        "   ```",
        "   @ img/monfichier.jpg | Légende",
        "   ```",
        "   ou, pour un hotlink sans téléchargement :",
        "   ```",
        "   @ https://... | Légende",
        "   ```",
        "",
        "Ou relance `python3 src/fetch_images.py --interactive` pour les reprendre une par une.",
        "",
    ]
    for basename, titre, région in items:
        links = search_links(titre, région)
        lines += [
            f"## {basename}",
            f"- Titre : {titre}" + (f" ({région})" if région else ""),
            f"- Recherche Commons : {links['commons']}",
            f"- Recherche Google Images : {links['gimages']}",
            "",
        ]
    REPORT_PATH.write_text("\n".join(lines), encoding="utf-8")


# ==========================================================================
# Orchestration
# ==========================================================================

def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--force", action="store_true", help="retente les échecs mémorisés (jamais les succès déjà acquis)")
    parser.add_argument("--retry-failed", action="store_true", help="synonyme de --force ici")
    parser.add_argument("--list", action="store_true", help="liste sans requêter le réseau")
    parser.add_argument("--pause", type=float, default=DEFAULT_PAUSE, help=f"secondes entre deux requêtes (défaut {DEFAULT_PAUSE})")
    parser.add_argument("--interactive", action="store_true", help="reprend les échecs un par un en fin de passe")
    add_data_argument(parser)
    args = parser.parse_args()
    configure(args.data)
    retry_failed = args.force or args.retry_failed

    fiches = load_all_fiches()
    cache = {} if retry_failed else load_cache()

    targets = sorted(
        (f for f in fiches.values() if f["family"] in IMAGEABLE_FAMILIES),
        key=lambda f: f["basename"],
    )

    done, skipped_has_image, skipped_failed, failed = 0, 0, 0, 0
    unresolved = []  # (basename, path, titre, région, candidates)

    def process(fiche):
        nonlocal done, skipped_has_image, skipped_failed, failed
        basename = fiche["basename"]
        header = fiche["header"]
        path = tmd2html.MD_DIR / f"{basename}.md"

        if has_image(fiche):
            skipped_has_image += 1
            if args.list:
                print(f"[a déjà une image] {basename}")
            return

        if basename in cache:
            skipped_failed += 1
            if args.list:
                print(f"[échec mémorisé, ignoré] {basename}")
            return

        if args.list:
            print(f"[sans image] {basename}")
            return

        titre = header.get("titre", basename)
        région = header.get("région", "")
        query = f"{titre} {région}".strip()

        print(f"Recherche image : {basename} ({query}) ...", end=" ", flush=True)
        candidates, err = search_and_fetch(query, args.pause)

        chosen = candidates[0] if candidates else None
        if chosen:
            url = chosen.get("thumburl") or chosen.get("url")
            dest = IMG_DIR / f"{basename}{ext_from_url(url)}"
            ok, derr = download_image(url, dest, args.pause)
            if ok:
                insert_image_line(path, f"@ img/{dest.name} | {titre}")
                print(f"OK -> img/{dest.name}  [{chosen['title']}]")
                done += 1
                return
            print(f"téléchargement échoué ({derr})")
        elif err:
            print(f"erreur de recherche ({err})")
        else:
            print("aucun résultat")

        failed += 1
        cache[basename] = None
        save_cache(cache)
        unresolved.append((basename, path, titre, région, candidates))

    interrupted = False
    try:
        for fiche in targets:
            process(fiche)

        if args.interactive and unresolved and not args.list:
            resolved_count, unresolved = interactive_resolve(unresolved, cache, args.pause)
            done += resolved_count
            failed = len(unresolved)
    except KeyboardInterrupt:
        interrupted = True
        print("\n\nInterrompu — les téléchargements déjà faits restent en place.")

    if not args.list:
        save_cache(cache)

        report_items = []
        for fiche in targets:
            basename = fiche["basename"]
            if not has_image(fiche) and basename in cache and cache[basename] is None:
                h = fiche["header"]
                report_items.append((basename, h.get("titre", basename), h.get("région", "")))
        write_report(report_items)

        if not interrupted:
            print(
                f"\n{len(targets)} fiches concernées — "
                f"{done} illustrées, {skipped_has_image} avaient déjà une image, "
                f"{skipped_failed} échecs mémorisés ignorés (--retry-failed pour les reprendre), "
                f"{len(report_items)} sans image au total."
            )
            if report_items:
                print(f"Détail + liens de recherche : {REPORT_PATH.relative_to(DATA)}")
                if not args.interactive:
                    print("(ou relance avec --interactive pour reprendre tout de suite)")


if __name__ == "__main__":
    main()
