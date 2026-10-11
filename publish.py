#!/usr/bin/env python3
"""
publish.py — construit le carnet (TMD -> HTML) puis le déploie en rsync/SSH.

Dossier des données, par ordre de priorité :
  1. l'option --data
  2. la variable d'environnement CARNET_DATA
  3. DATA_DIR dans publish.conf (relatif au moteur s'il n'est pas absolu)
  4. <moteur>/data

Configuration : copie publish.conf.example en publish.conf et renseigne ton
serveur. publish.conf n'est jamais suivi par git (coordonnées du serveur).
"""

import argparse
import os
import shlex
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DEFAULT_CONFIG = ROOT / "publish.conf"

# Scripts de build : utiles ici, inutiles (et non envoyés) sur le serveur.
BUILD_SCRIPTS = ("tmd2html.py", "geocode.py", "fetch_images.py")

# Droits appliqués par rsync aux fichiers transférés.
RSYNC_CHMOD = "--chmod=Du=rwx,Dg=rx,Do=rx,Fu=rw,Fg=r,Fo=r"


class PublishError(Exception):
    """Erreur attendue : message lisible, pas de trace Python."""


# ----------------------------------------------------------------------
# Configuration
# ----------------------------------------------------------------------

@dataclass(frozen=True)
class Config:
    user: str
    host: str
    path: str
    port: str = "22"
    key: str = ""
    site_url: str = ""

    @property
    def target(self):
        return f"{self.user}@{self.host}"

    def ssh_base(self):
        cmd = ["ssh", "-p", self.port]
        if self.key:
            cmd += ["-i", self.key]
        return cmd

    def remote(self, relative=""):
        return f"{self.path.rstrip('/')}/{relative}" if relative else self.path


def read_conf(path):
    """Lit un fichier KEY="valeur" (format publish.conf) sans l'exécuter."""
    values = {}
    for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[len("export "):].lstrip()
        key, sep, raw = line.partition("=")
        if not sep or not key.isidentifier():
            raise PublishError(f"{path.name}, ligne {number} illisible : {line!r}")
        try:
            words = shlex.split(raw, comments=True)
        except ValueError as err:
            raise PublishError(f"{path.name}, ligne {number} : {err}") from err
        values[key] = os.path.expanduser(os.path.expandvars(" ".join(words)))
    return values


def load_config(path, values):
    if not path.is_file():
        raise PublishError(
            f"Aucun fichier de configuration : {path}\n"
            "Copie publish.conf.example en publish.conf et renseigne ton serveur :\n"
            "  cp publish.conf.example publish.conf"
        )
    missing = [k for k in ("REMOTE_USER", "REMOTE_HOST", "REMOTE_PATH") if not values.get(k)]
    if missing:
        raise PublishError(f"{path.name} : variable(s) manquante(s) : {', '.join(missing)}")
    return Config(
        user=values["REMOTE_USER"],
        host=values["REMOTE_HOST"],
        path=values["REMOTE_PATH"],
        port=values.get("SSH_PORT") or "22",
        key=values.get("SSH_KEY", ""),
        site_url=values.get("SITE_URL", ""),
    )


def find_data_dir(cli_value, conf_value):
    if cli_value or os.environ.get("CARNET_DATA"):
        return Path(cli_value or os.environ["CARNET_DATA"]).expanduser().resolve()
    if conf_value:
        return (ROOT / Path(conf_value).expanduser()).resolve()
    return ROOT / "data"


# ----------------------------------------------------------------------
# Ce qu'on envoie
# ----------------------------------------------------------------------

@dataclass(frozen=True)
class Item:
    label: str
    source: Path
    dest: str                    # relatif à REMOTE_PATH
    exclude: tuple = ()

    @property
    def is_dir(self):
        return self.source.is_dir()


def deploy_items(data):
    return [
        Item("html/", ROOT / "html", "html"),
        Item("src/ (sans les scripts de build)", ROOT / "src", "src",
             exclude=BUILD_SCRIPTS + ("__pycache__/",)),
        Item("icons/", ROOT / "icons", "icons"),
        Item("img/ (données)", data / "img", "img"),
        Item("index.html", ROOT / "index.html", "index.html"),
        Item("service-worker.js", ROOT / "service-worker.js", "service-worker.js"),
        Item("manifest.json (données)", data / "manifest.json", "manifest.json"),
    ]


# ----------------------------------------------------------------------
# Exécution
# ----------------------------------------------------------------------

def step(message):
    print(f"==> {message}", flush=True)


def run(cmd):
    try:
        subprocess.run(cmd, check=True)
    except subprocess.CalledProcessError as err:
        raise PublishError(f"Commande en échec (code {err.returncode}) : {shlex.join(map(str, cmd))}") from err


def check_prereqs(deploying, building, data):
    if deploying:
        missing = [tool for tool in ("rsync", "ssh") if not shutil.which(tool)]
        if missing:
            raise PublishError(f"Outil(s) introuvable(s) : {', '.join(missing)}")
    if building and not (data / "md").is_dir():
        raise PublishError(
            f"Données introuvables : {data / 'md'}\n"
            "Indique le dossier avec --data DIR (ou CARNET_DATA, ou DATA_DIR dans publish.conf)."
        )
    if deploying and not building and not (ROOT / "html").is_dir():
        raise PublishError("Pas de dossier html/ — lance le build au moins une fois.")


def build(data):
    step(f"Conversion des fiches (données : {data})")
    run([sys.executable, str(ROOT / "src" / "tmd2html.py"), "--data", str(data)])


def ssh(cfg, script):
    run([*cfg.ssh_base(), cfg.target, script])


def prepare_remote(cfg, items):
    step(f"Vérification du dossier distant {cfg.path}")
    dirs = [cfg.remote(item.dest) for item in items if item.is_dir]
    if dirs:
        ssh(cfg, f"mkdir -p {shlex.join(dirs)}")


def sync(cfg, item, dry_run):
    step(f"Envoi de {item.label}")
    source = f"{item.source}/" if item.is_dir else str(item.source)
    dest = cfg.remote(item.dest + "/" if item.is_dir else item.dest)
    cmd = ["rsync", "-avz", RSYNC_CHMOD, "-e", shlex.join(cfg.ssh_base())]
    if item.is_dir:
        cmd.append("--delete")
    cmd += [f"--exclude={pattern}" for pattern in item.exclude]
    if dry_run:
        cmd.append("--dry-run")
    cmd += [source, f"{cfg.target}:{shlex.quote(dest)}"]
    run(cmd)


def fix_remote_perms(cfg, items):
    """Filet de sécurité : rsync --chmod ne touche que les fichiers retransférés.
    Un fichier identique resté en 600 d'un ancien déploiement serait illisible
    par le serveur web (404 silencieux sur le CSS/JS)."""
    step("Vérification des droits (dossiers 755 / fichiers 644)")
    dirs = [cfg.remote(i.dest) for i in items if i.is_dir]
    files = [cfg.remote(i.dest) for i in items if not i.is_dir]
    script = []
    if dirs:
        script.append(
            f'for d in {shlex.join(dirs)}; do\n'
            '  [ -d "$d" ] || continue\n'
            '  find "$d" -type d -exec chmod 755 {} +\n'
            '  find "$d" -type f -exec chmod 644 {} +\n'
            'done'
        )
    if files:
        script.append(
            f'for f in {shlex.join(files)}; do\n'
            '  [ -f "$f" ] && chmod 644 "$f"\n'
            'done'
        )
    if script:
        ssh(cfg, "\n".join(script) + "\ntrue")


def deploy(cfg, data, dry_run):
    items = []
    for item in deploy_items(data):
        if item.source.exists():
            items.append(item)
        else:
            step(f"{item.label} : absent, ignoré")

    if dry_run:
        step("Mode simulation (--dry-run) : rien n'est envoyé ni modifié sur le serveur")
    else:
        prepare_remote(cfg, items)
    for item in items:
        sync(cfg, item, dry_run)
    if dry_run:
        step("Simulation terminée, aucun fichier envoyé.")
        return
    fix_remote_perms(cfg, items)
    step(f"Déployé sur {cfg.host}:{cfg.path}")
    if cfg.site_url:
        step(cfg.site_url)


# ----------------------------------------------------------------------
# Point d'entrée
# ----------------------------------------------------------------------

def parse_args(argv=None):
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("-d", "--data", metavar="DIR", help="dossier des données")
    parser.add_argument("-c", "--config", metavar="FICHIER", type=Path, default=DEFAULT_CONFIG,
                        help="fichier de configuration (défaut : publish.conf)")
    parser.add_argument("-n", "--dry-run", action="store_true",
                        help="construit en local mais simule le déploiement")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--no-build", action="store_true",
                      help="déploie html/ tel quel, sans reconvertir")
    mode.add_argument("--build-only", action="store_true",
                      help="construit html/ sans déployer")
    return parser.parse_args(argv)


def main(argv=None):
    args = parse_args(argv)
    building = not args.no_build
    deploying = not args.build_only
    try:
        values = read_conf(args.config) if args.config.is_file() else {}
        cfg = load_config(args.config, values) if deploying else None
        data = find_data_dir(args.data, values.get("DATA_DIR"))
        check_prereqs(deploying, building, data)
        if building:
            build(data)
        if deploying:
            deploy(cfg, data, args.dry_run)
    except PublishError as err:
        print(f"Erreur : {err}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        return 130
    return 0


if __name__ == "__main__":
    sys.exit(main())
