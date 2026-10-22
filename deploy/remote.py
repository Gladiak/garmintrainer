#!/usr/bin/env python3
"""VPS operations. Only Python's standard library and Docker are required."""
import fcntl
import gzip
from http.cookies import SimpleCookie
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.error
import urllib.request

PROJECT = "garmintrainer-vps"
SECRET_NAMES = ("db_password", "db_root_password", "encryption_key")


def execute(args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)


def environment(root, domain, release):
    env = dict(os.environ)
    for name in list(env):
        if name.startswith("COMPOSE_"):
            del env[name]
    env.update(COMPOSE_DISABLE_ENV_FILE="true", DEPLOY_ROOT=str(root),
               APP_DOMAIN=domain, APP_UID=str(os.getuid()), APP_GID=str(os.getgid()),
               RELEASE_ID=release.name)
    return env


def compose(root, domain, release, *args, **kwargs):
    return execute(["docker", "compose", "--project-name", PROJECT,
                    "-f", str(release / "deploy/compose.vps.yaml"), *args],
                   env=environment(root, domain, release), **kwargs)


def current_release(root):
    current = root / "current"
    if not current.is_symlink():
        raise RuntimeError("Nessun deploy attivo: esegui npm run deploy:vps.")
    release = current.resolve(strict=True)
    if release.parent != root / "releases":
        raise RuntimeError("Il collegamento alla release corrente non è valido.")
    return release


def ensure_secrets(root):
    directory = root / "shared/secrets"
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    directory.chmod(0o700)
    files = [directory / name for name in SECRET_NAMES]
    present = [path.exists() for path in files]
    if any(present) and not all(present):
        raise RuntimeError("Secret incompleti: ripristinali dal backup, senza rigenerarli.")
    if not any(present):
        volume = subprocess.run(["docker", "volume", "inspect", f"{PROJECT}_mariadb_data"],
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if volume.returncode == 0:
            raise RuntimeError("Esiste già un database senza secret: ripristina le chiavi originali.")
        for path in files:
            value = secrets.token_bytes(32) if path.name == "encryption_key" else secrets.token_hex(32).encode()
            with path.open("xb") as stream:
                stream.write(value)
    for path in files:
        if path.is_symlink() or not path.is_file():
            raise RuntimeError("File secret non valido.")
        value = path.read_bytes()
        if value.startswith(b"\0GITCRYPT\0") or (path.name == "encryption_key" and len(value) != 32) or not value:
            raise RuntimeError("Secret non valido: ripristina i file originali dal backup.")
        path.chmod(0o600)


def backup(root, domain, release):
    directory = root / "backups"
    directory.mkdir(exist_ok=True, mode=0o700)
    directory.chmod(0o700)
    stamp = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime()) + "-" + secrets.token_hex(3)
    destination = directory / f"{stamp}.tar.gz"
    with tempfile.TemporaryDirectory(prefix=".backup-", dir=directory) as temporary:
        sql = Path(temporary) / "database.sql.gz"
        command = ['docker', 'compose', '--project-name', PROJECT, '-f',
                   str(release / 'deploy/compose.vps.yaml'), 'exec', '-T', 'db',
                   'sh', '-ec', 'export MYSQL_PWD="$(cat /run/secrets/db_root_password)"; '
                   'exec mariadb-dump --user=root --single-transaction --routines --events --databases garmintrainer']
        with gzip.open(sql, "wb") as stream:
            process = subprocess.Popen(command, env=environment(root, domain, release), stdout=subprocess.PIPE)
            try:
                shutil.copyfileobj(process.stdout, stream)
            finally:
                process.stdout.close()
            if process.wait() != 0:
                raise RuntimeError("Backup database non riuscito. Aggiornamento interrotto.")
        partial = Path(temporary) / "backup.tar.gz"
        with tarfile.open(partial, "w:gz") as archive:
            archive.add(sql, arcname="database.sql.gz")
            archive.add(root / "shared/secrets", arcname="secrets")
            archive.add(root / "deployment.json", arcname="deployment.json")
        partial.chmod(0o600)
        partial.replace(destination)
    print(f"Backup completo: {destination}", flush=True)
    return destination


def provision_phpmyadmin(root, domain, release):
    """Separate read-only account; the password never enters argv or Compose."""
    path = root / "shared/secrets/phpmyadmin_password"
    if path.is_symlink():
        raise RuntimeError("File password phpMyAdmin non valido.")
    if not path.exists():
        with path.open("x") as stream:
            stream.write(secrets.token_urlsafe(32))
    path.chmod(0o600)
    password = path.read_text().strip()
    if not re.fullmatch(r"[A-Za-z0-9_-]{43}", password):
        raise RuntimeError("Password phpMyAdmin non valida: ripristina il file originale.")
    sql = (f"CREATE USER IF NOT EXISTS 'dbviewer'@'%' IDENTIFIED BY '{password}';\n"
           f"ALTER USER 'dbviewer'@'%' IDENTIFIED BY '{password}';\n"
           "REVOKE ALL PRIVILEGES, GRANT OPTION FROM 'dbviewer'@'%';\n"
           "GRANT SELECT, SHOW VIEW ON garmintrainer.* TO 'dbviewer'@'%';\n")
    compose(root, domain, release, "exec", "-T", "db", "sh", "-ec",
            'export MYSQL_PWD="$(cat /run/secrets/db_root_password)"; exec mariadb --user=root',
            input=sql, text=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    print("phpMyAdmin: utente dbviewer configurato in sola lettura; password privata conservata sul VPS.", flush=True)


def verify(domain, attempts=1):
    base = f"https://{domain}"
    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(base + "/health", timeout=10) as response:
                if json.load(response) != {"status": "ok", "service": "garmintrainer"}:
                    raise RuntimeError("Health check inatteso.")
            with urllib.request.urlopen(base, timeout=10) as response:
                if "<script" not in response.read().decode():
                    raise RuntimeError("Frontend non disponibile.")
            with urllib.request.urlopen(base + "/phpmyadmin/", timeout=10) as response:
                page = response.read().decode()
                if 'name="pma_username"' not in page or 'name="pma_password"' not in page:
                    raise RuntimeError("Login phpMyAdmin non disponibile.")
                cookies = SimpleCookie()
                for header in response.headers.get_all("Set-Cookie", []):
                    cookies.load(header)
                session_cookies = [cookie for name, cookie in cookies.items() if "phpMyAdmin" in name]
                if not session_cookies or not all(cookie["secure"] and cookie["httponly"] for cookie in session_cookies):
                    raise RuntimeError("Cookie phpMyAdmin privo di Secure/HttpOnly.")
            try:
                urllib.request.urlopen(base + "/api/dashboard", timeout=10).close()
                raise RuntimeError("La dashboard deve richiedere il login.")
            except urllib.error.HTTPError as error:
                if error.code != 401 or json.load(error).get("error", {}).get("code") != "AUTH_REQUIRED":
                    raise RuntimeError("Protezione della dashboard non verificata.") from error
            print(f"Verifica HTTPS riuscita: health, frontend, dashboard protetta e login phpMyAdmin.\nApp disponibile: {base}\nphpMyAdmin: {base}/phpmyadmin/", flush=True)
            return
        except (OSError, ValueError, RuntimeError) as error:
            if attempt == attempts - 1:
                raise RuntimeError(f"Container avviati, ma HTTPS non verificato: {error}. "
                                   "Controlla DNS, porte 80/443 e log del proxy; poi esegui npm run deploy:vps -- verify.") from error
            time.sleep(5)


def deploy(root, domain, release_name):
    release = root / "releases" / release_name
    if not release.is_dir() or release.resolve().parent != root / "releases":
        raise RuntimeError("Release non valida.")
    execute(["docker", "info", "--format", "Docker {{.ServerVersion}}"])
    previous = current_release(root) if (root / "current").is_symlink() else None
    state_path = root / "deployment.json"
    if state_path.exists() and json.loads(state_path.read_text())["domain"] != domain:
        raise RuntimeError("Il dominio differisce dal deploy esistente. Modifica prima deployment.json sul VPS.")
    ensure_secrets(root)
    compose(root, domain, release, "config", "--quiet")
    # Build first: a failed build never interrupts the running application.
    compose(root, domain, release, "build", "--pull", "app")
    if previous:
        backup(root, domain, previous)
    compose(root, domain, release, "up", "-d", "--wait", "--wait-timeout", "180", "db")
    provision_phpmyadmin(root, domain, release)
    compose(root, domain, release, "up", "-d", "--no-build", "--wait", "--wait-timeout", "240")
    # Keep data and certificates outside releases; never run down -v or prune.
    temporary_link = root / "current.next"
    temporary_link.unlink(missing_ok=True)
    temporary_link.symlink_to(release)
    temporary_link.replace(root / "current")
    state_path.write_text(json.dumps({"domain": domain, "release": release.name,
                                      "previousRelease": previous.name if previous else None}, indent=2) + "\n")
    state_path.chmod(0o600)
    compose(root, domain, release, "ps")
    verify(domain, attempts=12)


def main():
    os.umask(0o077)
    action, directory, domain, *extra = sys.argv[1:]
    root = Path(directory).resolve()
    if action not in ("deploy", "status", "logs", "backup", "verify"):
        raise RuntimeError("Azione non valida.")
    if action == "verify":
        verify(domain)
        return
    if action == "status":
        compose(root, domain, current_release(root), "ps")
        return
    if action == "logs":
        compose(root, domain, current_release(root), "logs", "--tail", "100", "-f")
        return
    with (root / ".deploy.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise RuntimeError("Un altro deploy o backup è già in corso.") from error
        if action == "deploy":
            deploy(root, domain, extra[0])
        else:
            backup(root, domain, current_release(root))


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, subprocess.CalledProcessError, OSError, ValueError, IndexError) as error:
        print(f"Deploy: {error}", file=sys.stderr)
        sys.exit(1)
