# TravelBook

Moteur générique qui transforme des fiches de voyage (format TMD) en carnet statique et installable (PWA). Le moteur ne contient aucune donnée de voyage : elles vivent dans un dépôt séparé.

## Ce que contient ce dépôt (le moteur)

- `src/` : convertisseur `tmd2html.py`, scripts `geocode.py` et `fetch_images.py`, CSS et JS des vues (carnet, bibliothèque, brouillon, admin).
- `service-worker.js`, `icons/`, `index.html` : la coquille PWA.
- `publish.py` et `publish.conf.example` : build puis déploiement rsync/SSH.
- `docs/format-tmd.md` : spécification du format TMD.

## Ce qui n'est pas ici

- Les données (`md/`, `pages/`, `img/`, `manifest.json`, caches) : dépôt privé `lstux/TravelBook-Slovakia`.
- `html/` : généré à chaque build.
- `publish.conf` : coordonnées du serveur, jamais versionnées.

## Mise en place locale

```
git clone https://github.com/lstux/TravelBook
cd TravelBook
git clone https://github.com/lstux/TravelBook-Slovakia data
cp publish.conf.example publish.conf    # puis renseigner le serveur
```

## Dossier des données

`tmd2html.py`, `geocode.py`, `fetch_images.py` et `publish.py` cherchent les données au même endroit, dans cet ordre :

1. l'option `--data DIR` (ou `-d`)
2. la variable d'environnement `CARNET_DATA`
3. `DATA_DIR` dans `publish.conf` (uniquement pour `publish.py`)
4. le dossier `data/` à la racine du moteur

## Utilisation

```
python3 src/tmd2html.py --data ../TravelBook-Slovakia    # build -> html/
python3 src/geocode.py --list                            # lieux restant à géocoder
python3 src/fetch_images.py --list                       # fiches sans image

./publish.py                    # build + déploiement
./publish.py --dry-run          # build local, déploiement simulé (rien n'est envoyé)
./publish.py --no-build         # déploie html/ tel quel
./publish.py --build-only       # construit html/ sans déployer
./publish.py --data DIR         # autre dossier de données
./publish.py --config FICHIER   # autre fichier de configuration
```

Pour prévisualiser le site en local, le HTML généré attend `img/` et `manifest.json` à la racine du moteur, donc créer deux liens :

```
ln -s data/img img
ln -s data/manifest.json manifest.json
```

## Format

Les fiches sources sont en TMD (Travel MarkDown), un texte brut lisible et éditable à la main. Voir [docs/format-tmd.md](docs/format-tmd.md).

## Licence

À définir.
