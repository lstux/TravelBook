# TravelBook

Carnet de voyage numérique : un **moteur** générique qui transforme des fiches de voyage en site statique (PWA), séparé des **données** du voyage.

## Structure (prévue)

- **Moteur** : le convertisseur (`tmd2html.py`), les scripts utilitaires (géocodage, images), le CSS, les pages d'interface (carnet, brouillon, admin) et le service worker. Rien de spécifique à un pays ou à un voyage.
- **Données** : les fiches au format TMD (`md/`), les pages éditoriales écrites à la main (`pages/`), les images (`img/`) et les caches générés. Ces données vivent dans leur propre dépôt ou dossier et sont branchées sur le moteur au moment du build.

Le contenu n'est pas encore versionné ici : ce dépôt ne contient pour l'instant que ce README et le `.gitignore`.

## Format

Les fiches sources sont en TMD (Travel MarkDown), un format texte brut lisible et éditable à la main. La spécification sera ajoutée ici lorsque le moteur sera importé.

## Licence

À définir.
