# TravelBook

Moteur générique qui transforme des fiches de voyage (format TMD) en carnet statique et installable (PWA). Le moteur ne contient aucune donnée de voyage : elles vivent dans un dépôt séparé.

## Ce que contient ce dépôt (le moteur)

- `src/` : convertisseur `tmd2html.py`, scripts `geocode.py` et `fetch_images.py`, CSS et JS des vues (carnet, bibliothèque, brouillon, admin).
- `service-worker.js`, `icons/`, `index.html` : la coquille PWA.
- `publish-travelbook.sh` et `publish.conf.example` : build puis déploiement rsync/SSH.
- `docs/format-tmd.md` : spécification du format TMD.

## Ce qui n'est pas ici

- Les données (`md/`, `pages/`, `img/`, `manifest.json`, caches) : dépôt privé `lstux/TravelBook-Slovakia`.
- `html/` : généré à chaque build.
- `publish.conf` : coordonnées du serveur, jamais versionnées.

## Mise en place locale

```
git clone https://github.com/lstux/TravelBook
git clone https://github.com/lstux/TravelBook-Slovakia data
cp publish.conf.example publish.conf    # puis renseigner le serveur
```

Par défaut le moteur lit les données dans `data/`. Pour pointer ailleurs, définir `CARNET_DATA=/chemin/vers/les/donnees` : c'est lu à la fois par `tmd2html.py`, `geocode.py`, `fetch_images.py` et `publish-travelbook.sh`.

Pour prévisualiser le site en local, le HTML généré attend `img/` et `manifest.json` à la racine du moteur, donc créer deux liens :

```
ln -s data/img img
ln -s data/manifest.json manifest.json
```

Puis :

```
python3 src/tmd2html.py              # build -> html/
./publish-travelbook.sh --dry-run    # simulation du déploiement
./publish-travelbook.sh              # build + déploiement
```

## Format

Les fiches sources sont en TMD (Travel MarkDown), un texte brut lisible et éditable à la main. Voir [docs/format-tmd.md](docs/format-tmd.md).

## Licence

À définir.
