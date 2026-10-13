# Format TMD (Travel MarkDown)

Spécification du langage utilisé dans les fiches sources (`md/*.md`) du carnet Slovaquie. Un fichier TMD est un fichier texte brut, lisible et éditable à la main, converti en HTML par `src/tmd2html.py`.

Principe de base : **aucune information de présentation dans la source**. Le fichier dit *quoi*, le CSS et le convertisseur décident *comment*. Tout élément absent est simplement ignoré au rendu (dégradation gracieuse) — jamais de page cassée pour un champ manquant.

---

## 1. Anatomie d'une fiche

Un fichier `.md` a deux parties, dans cet ordre :

1. **En-tête** : une suite de lignes `clé: valeur`, une par ligne, en tout début de fichier.
2. **Corps** : une suite de blocs (voir §3), dans l'ordre où tu veux qu'ils apparaissent.

```
titre: Vlkolínec
région: Liptov
type: village-patrimoine
famille-ok: facile
étapes-candidates: Liptov

# rando (durée: 1h30, dénivelé: 150m, difficulté: facile)

@ img/vlkolinec.svg | Les toits de bois traditionnels

+ notre avis: à faire tôt le matin, les bus arrivent vers 10h.
~ Treba prísť skoro ráno.

! anecdote
Village en bois toujours habité, pas un musée à ciel ouvert.
~ Vlkolínec je stále obývaná dedina, nie skanzen.
```

Les lignes vides séparent visuellement les blocs mais ne sont pas obligatoires pour le parseur — elles servent surtout à la lisibilité du fichier source.

---

## 2. Nommage des fichiers & familles

Le nom du fichier (sans `.md`) détermine la **famille** de la fiche : tout ce qui précède le premier `_` doit être l'un de :

```
Lieu_     Dodo_     Specialite_     Table_     Culture_     Etape_
```

Exemples : `Lieu_Liptov_vlkolinec.md`, `Dodo_Bratislava_zlate-piesky.md`, `Etape_Liptov.md`.

Le nom de fichier (sans extension) sert aussi d'**identifiant** pour les liens croisés (`->`, voir §3.5) — il doit donc rester stable une fois d'autres fiches liées à lui.

---

## 3. Les blocs du corps

### 3.1 `#` — bloc chiffré

Données structurées, rendues en badges. Une seule ligne, nom du bloc puis paires `clé: valeur` entre parenthèses.

```
# rando (durée: 1h30, dénivelé: 150m, difficulté: facile, balisage: rouge)
# confort (électricité: oui, douche: oui, distance-douche: 50m, eau-potable: oui)
```

Blocs connus du convertisseur : `rando` (fiches Lieu) et `confort` (fiches Dodo). Pour `confort`, une valeur `oui` devient un badge ; `non` est ignoré ; toute autre valeur (ex. `distance-douche: 50m`) s'affiche telle quelle.

### 3.2 `+` — champ pratique

La brique la plus utilisée. Trois usages :

```
+ prix: ~18€/nuit pour 2 adultes + 1 enfant
+ notre avis: à faire tôt le matin, les bus arrivent vers 10h.
+ Google Maps: https://www.google.com/maps/search/?api=1&query=Vlkolinec
```

- `+ label: texte` → affiché dans une carte "Infos pratiques" (label en gras, valeur à côté).
- `+ notre avis: texte` → carte dédiée "Notre avis", mise en avant.
- `+ label: https://...` → **lien cliquable automatique** (le convertisseur détecte `http://`/`https://` et transforme la valeur en `<a>`).

Un champ `+ plan-B -> Fichier` ou `+ spécialités-servies -> F1, F2` (voir §3.5) est un cas particulier : lien(s) vers d'autres fiches plutôt que du texte.

### 3.3 `!` — anecdote

```
! anecdote
Le texte peut courir sur plusieurs lignes, tant qu'il n'y a pas
de ligne vide ou un autre marqueur de bloc entre les deux.
~ Traduction slovaque optionnelle.
```

Rendu dans un encart visuellement distinct (bordure accent). Le mot après `!` n'est pas obligatoire (`!` seul fonctionne aussi) — c'est juste une étiquette de lisibilité dans le fichier source.

### 3.4 `@` — image

```
@ img/vlkolinec.svg | Les toits de bois traditionnels de Vlkolínec
@ https://commons.wikimedia.org/wiki/Special:FilePath/Bratislava%20Castle.jpg | Château
```

- Chemin **local** (`img/...`) → doit exister dans le dossier `img/` du projet.
- URL **absolue** (`http://` ou `https://`) → utilisée telle quelle (hotlink), pratique pour réutiliser directement une image Wikimedia sans la télécharger.

La **première image d'une fiche** sert aussi de vignette partout où cette fiche est référencée (Bibliothèque, Brouillon, composition d'une Étape, chapitres du Carnet). Sans image, une vignette de repli (aplat de couleur + initiale du titre) s'affiche automatiquement — jamais d'image cassée.

### 3.5 `->` — lien vers une autre fiche

Deux syntaxes :

```
+ plan-B -> Dodo_Liptov_camping-repas
+ spécialités-servies -> Specialite_halusky, Specialite_kofola
```
```
-> Lieu_Liptov_vlkolinec
```

- **Dans un champ** (`+ label -> cible[, cible2...]`) : rendu en pastilles cliquables sous une carte "label".
- **En ligne isolée** (uniquement dans une fiche Étape) : ajoute la fiche cible à la composition de l'étape (voir §4).

La cible est le **nom de fichier sans `.md`**. Le convertisseur vérifie que la cible existe ; une cible introuvable s'affiche comme "fiche manquante" au lieu de casser la page.

### 3.6 `~` — traduction slovaque

```
+ notre avis: à faire tôt le matin.
~ Treba prísť skoro ráno.
```

S'accroche **au bloc juste au-dessus** (champ, avis, anecdote, intro d'étape...) et devient un petit texte cliquable "🔊" qui déclenche la lecture vocale en slovaque via `slovak.js`. Absente = pas de bouton, aucune page cassée. Une seule ligne `~` par bloc (la première rencontrée est celle qui compte).

### 3.7 `==` — jour (fiches Étape uniquement)

```
== Jour 1
-> Lieu_Liptov_vlkolinec
-> Table_Liptov_resto-koliba

== Jour 2
-> Lieu_Liptov_thermes
```

Regroupe les fiches liées sous un sous-titre. **Optionnel** : sans aucun `==`, la composition s'affiche en liste plate. À utiliser seulement quand une étape est assez chargée pour mériter un découpage.

---

## 4. Cas particulier : la fiche Étape

Une fiche `Etape_*.md` a des champs d'en-tête et un comportement de rendu spécifiques.

**En-tête**
```
titre: Liptov
région: Liptov
nuits: 2
trajet-depuis-précédente: étape: Malá Fatra, distance: 85km, durée: 1h30
```

**Comportement de rendu propre aux Étapes :**
- Le champ `+ intro: ...` (label commençant par "intro") est mis en avant dans une carte "Ambiance" plutôt que dans "Infos pratiques".
- Les fiches liées (`->`) de famille **Dodo** et **Table** ne suivent **jamais** le regroupement par jour : elles sont automatiquement extraites et affichées à part, en deux sections dédiées "Où dormir" / "Où manger", **en fin de fiche**, quel que soit l'endroit où elles apparaissent dans le fichier source.
- Les fiches liées des autres familles (Lieu, Culture) restent dans le fil des jours (`==`), ou en liste plate si aucun `==` n'est présent.
- Navigation automatique en bas de page : précédent/suivant vers l'étape adjacente dans `md/etapes.txt`.

---

## 5. Le fichier d'ordre global : `etapes.txt`

```
Etape_Bratislava
Etape_Banska-Stiavnica
Etape_Mala-Fatra
```

Une ligne = une étape, dans l'ordre du voyage. C'est la **source de vérité** de la vue Carnet — une fiche Étape qui n'y figure pas n'apparaît pas dans le Carnet final (mais reste visible en Bibliothèque).

---

## 6. Tri brouillon vs décision : `étapes-candidates`

Sur une fiche **Lieu** ou **Culture** uniquement :

```
étapes-candidates: Liptov, Route-du-retour
```

Champ libre, non contraignant : sert uniquement à regrouper les fiches pas encore affectées à une étape dans la vue Brouillon. Une fiche peut avoir plusieurs candidates, une seule, ou aucune (elle apparaît alors dans "En réflexion").

---

## 6bis. L'agenda (page générée)

`agenda.html` est construit à partir des étapes : chaque section `== ...` d'une étape devient un jour, dans l'ordre de `etapes.txt`. Les sections dont le titre commence par `Extras`, `Extension`, `Petites`, `Secteur` ou `Option` ne sont pas des jours : leurs lieux sont proposés en option à la fin du dernier jour de l'étape.

- `-> Lieu_...` : le programme du jour. Durée de visite : champ `durée-visite` de la fiche (`45min`, `2h`, `1h30`), sinon `durée` du bloc `# rando`, sinon 1h30 (affichée « ~ »).
- `-> Dodo_...` : l'hébergement. Le premier est « prévu », les autres sont des alternatives, avec les `+ plan-B ->` de la fiche Dodo.
- `-> Table_...` de l'étape : proposés pour le repas de midi.
- `+ à goûter -> Specialite_...` sur l'étape : rappelé dans chaque jour.
- Les trajets sont estimés à vol d'oiseau (× 1,35, 55 km/h) à partir des coordonnées de `geocache.json` et du champ `gps` de l'étape.

Dans le navigateur : la date de départ, les lieux retenus, le choix du repas et l'ordre du programme sont mémorisés localement (localStorage).

Le programme d'un jour est une frise : la hauteur d'un bloc suit sa durée, et les heures se recalent en cascade quand on déplace un bloc (poignée `⠿`, ou flèches haut/bas au clavier). Le déjeuner (`M`) et le dodo (`D`) sont déplaçables comme les lieux. Un lieu coché à la main s'ajoute en fin de journée, avant le dodo.

---

## 7. Référence rapide par famille

| Famille | Champs d'en-tête typiques | Blocs `#` |
|---|---|---|
| **Lieu** | `région`, `type`, `famille-ok` (`facile`/`moyen`/`à-éviter`), `étapes-candidates`, `durée-visite` (`45min`, `2h`, `1h30` — utilisée par l'agenda, 1h30 par défaut) | `rando` |
| **Dodo** | `région`, `type`, `gps`, `compatible`, `confort-global` (`sommaire`/`moyen`/`élevé`) | `confort` |
| **Specialite** | `catégorie`, `région-origine` | — |
| **Table** | `région`, `type`, `prix` (`€`/`€€`/`€€€`) | — |
| **Culture** | `catégorie` (`histoire`/`société`/`langue`/`code-pratique`), `région` (optionnel), `étapes-candidates` | — |
| **Etape** | `région`, `nuits`, `trajet-depuis-précédente` | — |

Tous les champs d'en-tête sont optionnels sauf `titre`. Un champ absent n'affiche simplement pas le badge/la ligne correspondante.

---

## 9. Cartes Leaflet (géocodage automatique)

Le Carnet (vue d'ensemble) et chaque fiche Étape peuvent afficher une carte
Leaflet — étapes reliées par un tracé pour le Carnet, lieux de l'étape pour
une fiche Étape. **Aucune modification des fiches n'est nécessaire** : les
coordonnées sont déduites automatiquement de `titre` + `région`.

```
python3 src/geocode.py
```

Ce script géocode les fiches `Lieu` et `Étape` via Nominatim/OpenStreetMap,
met les résultats en cache dans `geocache.json` (jamais re-interrogé une
fois en cache), puis `tmd2html.py` lit ce cache au prochain build.

- `geocache-approx.json` (facultatif) place les fiches qui n'ont pas de lieu
  précis (une soirée sans programme, une balade en bateau…) : `{"Lieu_x":
  {"lat": 48.14, "lon": 17.10, "note": "centre-ville"}}`. Ces points ne
  passent jamais devant ceux de `geocache.json` ; ils sont affichés en
  pointillé avec la mention « emplacement approximatif ».
- Sans `geocache.json`, ou pour une fiche non géocodée : pas de carte du
  tout sur cette page — dégradation gracieuse, pas de carte vide.
- Un titre composé ("Danube & Most SNP") qui échoue en entier est retenté
  automatiquement segment par segment. Un segment seul est moins fiable
  (« Danube » pourrait pointer hors de Slovaquie) : ces résultats sont
  quand même gardés (la carte a besoin d'un point), mais listés à part
  dans `geocode-a-completer.md`, section "À vérifier".
- `python3 src/geocode.py --interactive` reprend en fin de passe, une par
  une, les fiches n'ayant RIEN trouvé automatiquement : menu numéroté des
  recherches déjà tentées, possibilité de taper une recherche libre, et
  affichage du nom complet renvoyé par Nominatim avant de valider.
- Pour corriger un lieu mal géocodé (nom ambigu, lieu-dit trop petit),
  ajoute un champ dans l'en-tête de la fiche concernée, toujours prioritaire
  sur le géocodage automatique et sans besoin de réseau :
```
gps: 49.0432, 19.5964
```

`geocode.py --list` liste ce qui reste à géocoder sans faire de requête.
`geocode.py --force` ignore le cache et tout re-géocode.
`geocode.py --pause 3` espace davantage les requêtes (utile après un 429).

---

## 9bis. `admin.html` / `admin2.html` — organiser les fiches en étapes

Deux pages outils, générées comme le reste à partir de l'état actuel des
fichiers et publiées avec le site (site privé, à usage du couple — les
deux doivent pouvoir réorganiser depuis n'importe quel appareil, y
compris une fois en ligne). Elles utilisent la même clé de `localStorage`,
ce qui veut dire que si tu les ouvres **dans le même navigateur** (ex. les
deux onglets sur ton PC pour comparer), elles partagent le même brouillon.
En revanche, `localStorage` ne se synchronise pas entre appareils :
ouvertes sur deux appareils différents (PC + téléphone Android), chacune
garde son propre brouillon local, sans lien entre les deux tant que tu
n'as pas exporté et recopié dans les fichiers sources.

- **`admin.html`** (desktop) — tableau à la Kanban : une colonne "Non
  classé" + une colonne par étape, cartes glissées à la souris d'une
  colonne à l'autre.
- **`admin2.html`** (mobile) — même contenu, interaction différente
  (le glisser-déposer souris ne marche pas bien au doigt) : un
  sélecteur pour choisir le groupe affiché, des boutons ▲▼ pour
  réordonner, une liste déroulante pour réaffecter une fiche à une
  autre étape.

Les deux ont les mêmes onglets **Carte** (fiches géocodées, filtrables
par région/statut/recherche) et **Export** (génère `etapes.txt` à jour
et, par étape, la liste plate des `-> Fichier` à recopier par-dessus les
liens existants dans le `.md` correspondant — l'intro, les champs et
l'anecdote restent à écrire à la main).

Le bouton "Réinitialiser depuis les fichiers" abandonne les changements
non exportés et repart de l'état réel des `.md`, sur les deux pages.

---

## 9ter. `fetch_images.py` — illustrer automatiquement les fiches

Même logique que `geocode.py`, pour les images cette fois : repère les
fiches `Lieu`/`Dodo`/`Table`/`Culture`/`Étape` sans ligne `@`, cherche une
illustration sur Wikimedia Commons, la télécharge dans `img/` et ajoute
la ligne `@ img/fichier.jpg | légende` dans la fiche.

```
python3 src/fetch_images.py
```

- **Ne touche jamais une fiche qui a déjà une image**, peu importe d'où
  elle vient (script ou ajout manuel) — pour la remplacer, retire d'abord
  la ligne `@ ...` toi-même.
- Un échec est mémorisé dans `imgcache.json` (basename -> `null`) et n'est
  pas re-cherché tout seul à la relance suivante — mêmes réflexes que
  `geocode.py` (`--retry-failed` / `--force`, synonymes ici, pour les
  reprendre ; `--list` pour voir l'état sans requêter ; `--pause` pour
  espacer davantage).
- `--interactive` reprend en fin de passe, une par une, les fiches sans
  résultat automatique : menu numéroté des candidats Wikimedia trouvés,
  possibilité de taper une nouvelle recherche ou de coller directement
  une URL d'image, avec liens de recherche Commons/Google Images en
  secours.
- Rapport `img-a-completer.md` généré pour ce qui reste, avec les mêmes
  liens de recherche prêts à l'emploi.
- Ctrl+C protégé comme `geocode.py` : rien n'est perdu, ni sur la passe
  automatique ni en pleine saisie interactive.

---

## 10. Principes de robustesse (pourquoi c'est fait comme ça)

- **Additif, jamais cassant** : un champ inconnu, une image absente, un lien mort → dégradation silencieuse, jamais d'erreur bloquante.
- **Un seul point de vérité par donnée** : une fiche existe une fois, elle est référencée (pas dupliquée) partout où elle apparaît (Bibliothèque, Brouillon, Étape, Carnet).
- **Le texte source ne connaît rien de la présentation** : aucune couleur, aucune taille, aucune mise en page dans un fichier `.md` — tout ça vit dans `src/style.css`.
