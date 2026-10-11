#!/usr/bin/env python3
"""
geocode.py — géocode les fiches (Étape + Lieu) via Nominatim/OpenStreetMap
et conserve les coordonnées dans geocache.json, pour alimenter les cartes
Leaflet du Carnet et des pages Étape.

Usage :
    python3 src/geocode.py                  géocode ce qui n'est pas en cache
    python3 src/geocode.py --force          re-géocode tout, ignore le cache
    python3 src/geocode.py --list           liste sans requêter le réseau
    python3 src/geocode.py --pause 3        espace davantage les requêtes
    python3 src/geocode.py --interactive    reprend les lieux introuvables
                                             un par un, en fin de passe

Aucune modification des fiches .md n'est nécessaire dans le cas général :
la requête utilise directement `titre` + `région` + "Slovaquie". Pour les
titres composés ("Danube & Most SNP"), le script retente automatiquement
avec chaque segment isolé — mais un segment seul (ex. "Danube") peut très
bien pointer ailleurs qu'en Slovaquie. Ces résultats-là sont donc acceptés
(la carte a besoin d'un point) mais listés à part dans le rapport, sous
"À vérifier", plutôt que traités avec la même confiance qu'une recherche
sur le titre complet.

Avec --interactive : les fiches qui n'ont RIEN trouvé (ni titre complet,
ni aucun segment) sont reprises une par une en fin de passe, avec un menu
numéroté des recherches déjà tentées + possibilité de taper une recherche
libre. Le résultat Nominatim (nom complet du lieu trouvé) est affiché
avant de valider, pour éviter d'enregistrer un mauvais point en confiance.

Pour un lieu qui reste incorrect ou introuvable, ajoute directement dans
l'en-tête de la fiche concernée (aucun réseau nécessaire, toujours
prioritaire sur le géocodage automatique) :

    gps: 49.0432, 19.5964

Sur la politique d'usage de Nominatim (1 requête/seconde maximum) :
- une pause s'applique après CHAQUE requête réseau, succès ou échec ;
- le cache est sauvegardé en continu (pas seulement à la fin) : un
  Ctrl+C ou une erreur en cours de route ne fait plus tout perdre.
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
from tmd2html import load_all_fiches, DATA  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
CACHE_PATH = DATA / "geocache.json"
REPORT_PATH = DATA / "geocode-a-completer.md"

USER_AGENT = "carnet-slovaquie/1.0 (usage personnel, sans contact public)"
COUNTRY = "Slovaquie"
DEFAULT_PAUSE = 1.5          # secondes entre deux requêtes, quel qu'en soit le résultat
RATE_LIMIT_BACKOFF = 5.0     # pause supplémentaire après un 429, avant une unique retentative

GEOCODABLE_FAMILIES = ("Etape", "Lieu")

# Séparateurs utilisés dans nos titres composés ("Danube & Most SNP",
# "Bratislavský hrad · Château"...). En cas d'échec de la requête complète,
# on retente avec chaque segment pris isolément.
TITLE_SEPARATORS = (" · ", " & ", " / ")


def load_cache():
    if not CACHE_PATH.exists():
        return {}
    return json.loads(CACHE_PATH.read_text(encoding="utf-8"))


def save_cache(cache):
    CACHE_PATH.write_text(
        json.dumps(cache, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def parse_gps_field(raw):
    """'49.0432, 19.5964' -> (49.0432, 19.5964), ou None si invalide."""
    try:
        lat_s, lon_s = raw.split(",")
        return float(lat_s.strip()), float(lon_s.strip())
    except (ValueError, AttributeError):
        return None


def query_candidates(titre, région):
    """Liste ordonnée de requêtes à essayer : titre complet d'abord, puis
    chaque segment si le titre contient un séparateur composé."""
    suffix = f", {région}, {COUNTRY}" if région else f", {COUNTRY}"
    seen = set()
    candidates = []

    def add(name):
        name = name.strip(" -·")
        if name and name not in seen:
            seen.add(name)
            candidates.append(f"{name}{suffix}")

    add(titre)
    for sep in TITLE_SEPARATORS:
        if sep in titre:
            for part in titre.split(sep):
                add(part)

    return candidates


def geocode_once(query):
    """Une tentative. Retourne {'lat','lon','display_name'} | None."""
    params = urllib.parse.urlencode({
        "q": query,
        "format": "json",
        "limit": 1,
        "accept-language": "fr",
    })
    url = f"https://nominatim.openstreetmap.org/search?{params}"
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=15) as response:
        data = json.load(response)
    if not data:
        return None
    return {
        "lat": float(data[0]["lat"]),
        "lon": float(data[0]["lon"]),
        "display_name": data[0].get("display_name", ""),
    }


def geocode_with_retry(query, pause):
    """Une requête + sa pause obligatoire, quel que soit le résultat.
    Sur 429, attend plus longtemps puis retente une seule fois."""
    try:
        result = geocode_once(query)
        time.sleep(pause)
        return result, None
    except urllib.error.HTTPError as exc:
        if exc.code == 429:
            time.sleep(RATE_LIMIT_BACKOFF)
            try:
                result = geocode_once(query)
                time.sleep(pause)
                return result, None
            except Exception as exc2:
                time.sleep(pause)
                return None, str(exc2)
        time.sleep(pause)
        return None, f"HTTP {exc.code}"
    except Exception as exc:
        time.sleep(pause)
        return None, str(exc)


def geocode_fiche(titre, région, pause):
    """Essaie chaque requête candidate jusqu'au premier succès.
    Retourne (result|None, query_gagnante, is_fallback, candidates, errors)."""
    candidates = query_candidates(titre, région)
    errors = []
    for i, query in enumerate(candidates):
        result, err = geocode_with_retry(query, pause)
        if result:
            return result, query, (i > 0), candidates, errors
        if err:
            errors.append(f"{query} -> {err}")
    return None, (candidates[-1] if candidates else None), False, candidates, errors


def search_links(titre, région):
    q = urllib.parse.quote(f"{titre}, {région}, {COUNTRY}" if région else f"{titre}, {COUNTRY}")
    return {
        "osm": f"https://nominatim.openstreetmap.org/ui/search.html?q={q}",
        "gmaps": f"https://www.google.com/maps/search/?api=1&query={q}",
    }


# ==========================================================================
# Mode interactif — reprend les fiches totalement introuvables
# ==========================================================================

def interactive_resolve(unresolved, cache, pause):
    """unresolved : liste de (basename, titre, région, candidates_déjà_tentés).
    Retourne (résolues_maintenant, toujours_non_résolues)."""
    still_unresolved = []
    resolved_count = 0
    total = len(unresolved)

    print(f"\n--- Mode interactif : {total} lieu(x) à reprendre ---\n")

    try:
        for idx, (basename, titre, région, candidates) in enumerate(unresolved, start=1):
            print(f"[{idx}/{total}] # {titre}" + (f"  ({région})" if région else "") + f"  [{basename}]")
            options = list(candidates)
            for i, q in enumerate(options, start=1):
                print(f"  {i}) {q}")
            print("  0) passer cette fiche")

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

                if choice.isdigit() and 1 <= int(choice) <= len(options):
                    query = options[int(choice) - 1]
                elif choice:
                    query = choice if région.lower() in choice.lower() or COUNTRY.lower() in choice.lower() \
                        else f"{choice}, {région}, {COUNTRY}" if région else f"{choice}, {COUNTRY}"
                else:
                    print("Entrée vide — un numéro, du texte libre, ou 0 pour passer.")
                    continue

                print(f"  Recherche : {query} ...", end=" ", flush=True)
                result, err = geocode_with_retry(query, pause)
                if not result:
                    print(f"aucun résultat ({err or 'introuvable'}). Réessaie.")
                    continue

                print(f"trouvé {result['lat']:.5f}, {result['lon']:.5f}")
                print(f"  → {result['display_name']}")
                confirm = input("  Accepter ? [O]ui / [N]on, réessayer / [S]auter > ").strip().lower()
                if confirm in ("", "o", "oui", "y", "yes"):
                    cache[basename] = [result["lat"], result["lon"]]
                    save_cache(cache)
                    resolved_count += 1
                    break
                if confirm in ("s", "sauter", "skip"):
                    still_unresolved.append((basename, titre, région))
                    break
                # "n" ou autre chose : reboucle sur le prompt de recherche

            print()
    except KeyboardInterrupt:
        print("\n\nInterrompu — ce qui a déjà été validé reste enregistré ; le reste part dans le rapport.")
        # La fiche en cours (si elle n'a pas déjà été classée) + toutes celles
        # pas encore vues retombent en "non résolues", pas perdues en silence.
        seen = {b for b, _, _ in still_unresolved}
        for basename, titre, région, _ in unresolved[idx - 1:]:
            if basename not in seen:
                still_unresolved.append((basename, titre, région))
                seen.add(basename)

    return resolved_count, still_unresolved


# ==========================================================================
# Rapport
# ==========================================================================

def write_report(unresolved, to_verify):
    if not unresolved and not to_verify:
        if REPORT_PATH.exists():
            REPORT_PATH.unlink()
        return

    lines = ["# Rapport de géocodage", ""]

    if to_verify:
        lines += [
            "## À vérifier — trouvé via un titre simplifié",
            "",
            "Le titre complet n'a rien donné ; le script a retenté avec un "
            "morceau du titre seul, ce qui peut tomber sur le mauvais endroit "
            "(un nom trop générique peut exister ailleurs qu'en Slovaquie). "
            "Les coordonnées sont déjà dans `geocache.json` — la carte "
            "fonctionne — mais une vérification rapide est recommandée.",
            "",
        ]
        for basename, titre, région, query, display_name, lat, lon in to_verify:
            links = search_links(titre, région)
            lines += [
                f"### {basename}",
                f"- Titre : {titre}" + (f" ({région})" if région else ""),
                f"- Trouvé via : « {query} »",
                f"- Résultat Nominatim : {display_name}",
                f"- Coordonnées retenues : {lat:.5f}, {lon:.5f}",
                f"- Vérifier : [OSM]({links['osm']}) · [Google Maps]({links['gmaps']})",
                "- Si c'est le bon endroit : rien à faire. Sinon, colle dans "
                f"`md/{basename}.md` :",
                "  ```",
                "  gps: LAT, LON",
                "  ```",
                "",
            ]

    if unresolved:
        lines += ["## Introuvable — à compléter à la main", ""]
        for basename, titre, région in unresolved:
            links = search_links(titre, région)
            lines += [
                f"### {basename}",
                f"- Titre : {titre}" + (f" ({région})" if région else ""),
                f"- Recherche OSM : {links['osm']}",
                f"- Recherche Google Maps : {links['gmaps']}",
                f"- À coller dans `md/{basename}.md` :",
                "  ```",
                "  gps: LAT, LON",
                "  ```",
                "",
            ]

    REPORT_PATH.write_text("\n".join(lines), encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--force", action="store_true", help="re-géocode tout, ignore le cache (y compris les échecs déjà mémorisés)")
    parser.add_argument("--retry-failed", action="store_true", help="retente uniquement les échecs déjà mémorisés (garde les succès en cache)")
    parser.add_argument("--list", action="store_true", help="liste sans requêter le réseau")
    parser.add_argument("--pause", type=float, default=DEFAULT_PAUSE, help=f"secondes entre deux requêtes (défaut {DEFAULT_PAUSE})")
    parser.add_argument("--interactive", action="store_true", help="reprend les lieux introuvables un par un en fin de passe")
    args = parser.parse_args()

    fiches = load_all_fiches()
    cache = {} if args.force else load_cache()

    if args.retry_failed:
        # Un échec mémorisé vaut `None` dans le cache (voir plus bas) : on
        # retire juste ces entrées-là pour qu'elles soient retentées,
        # sans toucher aux vrais succès déjà acquis.
        cache = {k: v for k, v in cache.items() if v is not None}

    targets = sorted(
        (f for f in fiches.values() if f["family"] in GEOCODABLE_FAMILIES),
        key=lambda f: f["basename"],
    )

    done, skipped, skipped_failed, failed = 0, 0, 0, 0
    unresolved = []   # (basename, titre, région, candidates)
    to_verify = []    # (basename, titre, région, query, display_name, lat, lon)

    def process(fiche):
        nonlocal done, skipped, skipped_failed, failed
        basename = fiche["basename"]
        header = fiche["header"]

        explicit = parse_gps_field(header.get("gps", ""))
        if explicit:
            cache[basename] = list(explicit)
            done += 1
            return

        if not args.force and basename in cache:
            if cache[basename] is None:
                # Déjà tenté, resté introuvable — on ne le re-recherche pas
                # tout seul (c'est justement ce qui déclenchait le 429 en
                # boucle). `--retry-failed` ou `gps:` dans la fiche pour agir.
                skipped_failed += 1
                if args.list:
                    print(f"[échec mémorisé, ignoré] {basename}")
                return
            skipped += 1
            if args.list:
                print(f"[déjà géocodé] {basename}")
            return

        if args.list:
            print(f"[à géocoder] {basename}")
            return

        titre = header.get("titre", basename)
        région = header.get("région", "")

        print(f"Géocodage : {basename} ({titre}) ...", end=" ", flush=True)
        result, query, is_fallback, candidates, errors = geocode_fiche(titre, région, args.pause)

        if result:
            cache[basename] = [result["lat"], result["lon"]]
            save_cache(cache)
            flag = "  [via titre simplifié -> à vérifier]" if is_fallback else ""
            print(f"{result['lat']:.5f}, {result['lon']:.5f}{flag}")
            done += 1
            if is_fallback:
                to_verify.append((basename, titre, région, query, result["display_name"], result["lat"], result["lon"]))
        else:
            print("introuvable")
            failed += 1
            # Mémorisé tout de suite : un simple Ctrl+C ou une relance ne
            # redemandera plus ce même nom en vain à chaque fois. Écrasé
            # dès qu'un vrai résultat est trouvé (passe --interactive ou
            # `gps:` manuel), jamais prioritaire sur un succès existant.
            cache[basename] = None
            save_cache(cache)
            unresolved.append((basename, titre, région, candidates))

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
        print("\n\nInterrompu — le cache déjà géocodé dans cette session est conservé.")

    if not args.list:
        save_cache(cache)

        # Le rapport reflète l'état RÉEL du cache — échecs de cette passe
        # + échecs déjà mémorisés lors d'une passe précédente et pas
        # retentés ici — pas seulement ce qui vient d'être tenté.
        report_unresolved = []
        for fiche in targets:
            basename = fiche["basename"]
            if basename in cache and cache[basename] is None:
                h = fiche["header"]
                report_unresolved.append((basename, h.get("titre", basename), h.get("région", "")))
        write_report(report_unresolved, to_verify)

        if not interrupted:
            print(
                f"\n{len(targets)} fiches concernées — "
                f"{done} géocodées, {skipped} déjà en cache, "
                f"{skipped_failed} échecs mémorisés ignorés (--retry-failed pour les reprendre), "
                f"{len(report_unresolved)} introuvables au total."
            )
            if to_verify:
                print(f"{len(to_verify)} résultat(s) trouvé(s) via un titre simplifié -> à vérifier dans {REPORT_PATH.name}.")
            if report_unresolved:
                print(f"Détail + liens de recherche : {REPORT_PATH.relative_to(DATA)}")
                print("Pour corriger : ajoute `gps: lat, lon` dans l'en-tête de la fiche concernée.")
            if not args.interactive and unresolved:
                print("(ou relance avec --interactive pour reprendre les échecs de cette passe tout de suite)")


if __name__ == "__main__":
    main()
