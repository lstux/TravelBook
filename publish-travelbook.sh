#!/usr/bin/env bash
#
# publish-travelbook.sh — build le carnet (TMD -> HTML) puis le déploie
# sur un serveur distant en rsync/SSH.
#
# Usage :
#   ./publish-travelbook.sh              build + déploiement
#   ./publish-travelbook.sh --dry-run    simule le rsync, rien n'est envoyé
#   ./publish-travelbook.sh --no-build   déploie html/ tel quel, sans reconvertir
#   ./publish-travelbook.sh -h           aide
#
# Configuration : copie publish.conf.example en publish.conf et renseigne
# tes propres valeurs. publish.conf n'est jamais suivi par git (voir .gitignore)
# puisqu'il contient les coordonnées de ton serveur.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Dépôt de données (md/, pages/, img/, manifest.json, caches). Par défaut data/
# à la racine du moteur ; surchargeable avec CARNET_DATA (même variable que tmd2html.py).
DATA_DIR="${CARNET_DATA:-$ROOT_DIR/data}"
CONFIG_FILE="$ROOT_DIR/publish.conf"

DRY_RUN=false
DO_BUILD=true

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    --no-build) DO_BUILD=false ;;
    -h|--help)
      sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "Option inconnue : $arg (essaie --help)" >&2
      exit 1
      ;;
  esac
done

# ----------------------------------------------------------------------
# Config
# ----------------------------------------------------------------------

if [[ ! -f "$CONFIG_FILE" ]]; then
  echo "Aucun publish.conf trouvé." >&2
  echo "Copie publish.conf.example en publish.conf et renseigne ton serveur :" >&2
  echo "  cp publish.conf.example publish.conf" >&2
  exit 1
fi

# shellcheck source=publish.conf.example
source "$CONFIG_FILE"

: "${REMOTE_USER:?REMOTE_USER manquant dans publish.conf}"
: "${REMOTE_HOST:?REMOTE_HOST manquant dans publish.conf}"
: "${REMOTE_PATH:?REMOTE_PATH manquant dans publish.conf}"

SSH_PORT="${SSH_PORT:-22}"
SSH_KEY="${SSH_KEY:-}"

SSH_OPTS=(-p "$SSH_PORT")
RSYNC_SSH="ssh -p $SSH_PORT"
if [[ -n "$SSH_KEY" ]]; then
  SSH_OPTS+=(-i "$SSH_KEY")
  RSYNC_SSH="$RSYNC_SSH -i $SSH_KEY"
fi

# ----------------------------------------------------------------------
# 1. Build : TMD -> HTML
# ----------------------------------------------------------------------

if $DO_BUILD; then
  echo "==> Conversion des fiches (tmd2html.py)"
  python3 "$ROOT_DIR/src/tmd2html.py"
else
  echo "==> Build sauté (--no-build), déploiement de html/ tel quel"
fi

if [[ ! -d "$ROOT_DIR/html" ]]; then
  echo "Pas de dossier html/ — lance le build au moins une fois." >&2
  exit 1
fi

# ----------------------------------------------------------------------
# 2. Prépare le dossier distant
# ----------------------------------------------------------------------

echo "==> Vérification du dossier distant $REMOTE_PATH"
# shellcheck disable=SC2029
ssh "${SSH_OPTS[@]}" "$REMOTE_USER@$REMOTE_HOST" "mkdir -p '$REMOTE_PATH/html' '$REMOTE_PATH/src' '$REMOTE_PATH/img' '$REMOTE_PATH/icons'"

# ----------------------------------------------------------------------
# 3. Déploiement rsync
#    On envoie html/, src/, img/ et l'index.html racine (redirection vers
#    html/) — pas md/ ni tmd2html.py : le serveur n'a besoin que du rendu
#    final et des assets consommés par le navigateur.
# ----------------------------------------------------------------------

RSYNC_OPTS=(-avz --delete --chmod=Du=rwx,Dg=rx,Do=rx,Fu=rw,Fg=r,Fo=r -e "$RSYNC_SSH")
if $DRY_RUN; then
  RSYNC_OPTS+=(--dry-run)
  echo "==> Mode simulation (--dry-run) : rien ne sera réellement envoyé"
fi

echo "==> Envoi de html/"
rsync "${RSYNC_OPTS[@]}" \
  "$ROOT_DIR/html/" "$REMOTE_USER@$REMOTE_HOST:$REMOTE_PATH/html/"

echo "==> Envoi de src/ (sans les scripts de build)"
rsync "${RSYNC_OPTS[@]}" \
  --exclude 'tmd2html.py' \
  --exclude 'geocode.py' \
  --exclude 'fetch_images.py' \
  --exclude '__pycache__/' \
  "$ROOT_DIR/src/" "$REMOTE_USER@$REMOTE_HOST:$REMOTE_PATH/src/"

if [[ -d "$DATA_DIR/img" ]]; then
  echo "==> Envoi de img/ (depuis les données)"
  rsync "${RSYNC_OPTS[@]}" \
    "$DATA_DIR/img/" "$REMOTE_USER@$REMOTE_HOST:$REMOTE_PATH/img/"
fi

if [[ -f "$ROOT_DIR/index.html" ]]; then
  echo "==> Envoi de l'index.html racine (redirection vers html/)"
  rsync "${RSYNC_OPTS[@]}" \
    "$ROOT_DIR/index.html" "$REMOTE_USER@$REMOTE_HOST:$REMOTE_PATH/index.html"
fi

if [[ -f "$DATA_DIR/manifest.json" ]]; then
  echo "==> Envoi de manifest.json (depuis les données)"
  rsync "${RSYNC_OPTS[@]}" \
    "$DATA_DIR/manifest.json" "$REMOTE_USER@$REMOTE_HOST:$REMOTE_PATH/manifest.json"
fi

if [[ -f "$ROOT_DIR/service-worker.js" ]]; then
  echo "==> Envoi de service-worker.js"
  rsync "${RSYNC_OPTS[@]}" \
    "$ROOT_DIR/service-worker.js" "$REMOTE_USER@$REMOTE_HOST:$REMOTE_PATH/service-worker.js"
fi

if [[ -d "$ROOT_DIR/icons" ]]; then
  echo "==> Envoi de icons/"
  rsync "${RSYNC_OPTS[@]}" \
    "$ROOT_DIR/icons/" "$REMOTE_USER@$REMOTE_HOST:$REMOTE_PATH/icons/"
fi

# ----------------------------------------------------------------------
# 4. Filet de sécurité : droits corrects même sur les fichiers déjà en
#    place. --chmod ci-dessus ne s'applique qu'aux fichiers réellement
#    retransférés — un fichier identique mais resté en 600 depuis un
#    déploiement antérieur (umask serveur, etc.) ne serait pas touché
#    sans ce passage explicite. Sans ça : fichier illisible par le
#    serveur web -> 404 silencieux sur le CSS/JS, page qui s'affiche
#    sans mise en page ni carte.
# ----------------------------------------------------------------------

if ! $DRY_RUN; then
  echo "==> Vérification des droits (dossiers 755 / fichiers 644)"
  # shellcheck disable=SC2029
  ssh "${SSH_OPTS[@]}" "$REMOTE_USER@$REMOTE_HOST" "
    for d in '$REMOTE_PATH/html' '$REMOTE_PATH/src' '$REMOTE_PATH/img' '$REMOTE_PATH/icons'; do
      [ -d \"\$d\" ] || continue
      find \"\$d\" -type d -exec chmod 755 {} +
      find \"\$d\" -type f -exec chmod 644 {} +
    done
    [ -f '$REMOTE_PATH/index.html' ] && chmod 644 '$REMOTE_PATH/index.html'
    [ -f '$REMOTE_PATH/manifest.json' ] && chmod 644 '$REMOTE_PATH/manifest.json'
    [ -f '$REMOTE_PATH/service-worker.js' ] && chmod 644 '$REMOTE_PATH/service-worker.js'
    true
  "
fi

if $DRY_RUN; then
  echo "==> Simulation terminée, aucun fichier envoyé."
else
  echo "==> Déployé sur $REMOTE_HOST:$REMOTE_PATH"
  if [[ -n "${SITE_URL:-}" ]]; then
    echo "==> $SITE_URL"
  fi
fi
