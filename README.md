# Garmin Trainer

Personal training dashboard with React, Express and MariaDB. Each registered user
has one private profile, a training plan, saved language/theme preferences and
optional Garmin credentials. Docker Compose runs the application and database
in separate containers.

## Start locally

Requirements: Docker with Compose and Node.js 22.12+ with npm for the setup helper.
Host dependencies are not needed to start the containers.

```bash
npm run docker:up
```

Open [http://127.0.0.1:8080](http://127.0.0.1:8080).

After cloning, unlock the installation secrets as described below. On an entirely
new installation without any secrets, the helper can generate random passwords
and a 32-byte encryption key.
Docker mounts them as read-only secrets, granting each service only the files it
needs. Configuration belongs in `compose.yaml`; the application reads container
settings and explicitly named secret files. Vite's automatic configuration-file
loading is disabled too.

| Service | Access | Persistence |
| --- | --- | --- |
| Application | `127.0.0.1:8080` | Encrypted account data in MariaDB |
| MariaDB 11.8 | Private Compose network, port 3306 | `garmintrainer_mariadb_data` volume |

Database migrations run before the backend accepts traffic. Health checks wait
for MariaDB and verify the application's database connection. The app runs as
the local user's UID/GID, with a non-root default. The database is not published
on a host port. The separate VPS configuration below adds HTTPS, secure cookies
and an explicit application origin.

```bash
npm run docker:logs   # Follow container logs
npm run docker:down   # Stop containers; preserve database and secrets
npm run docker:up     # Build/restart the compiled application
```

Change ports and non-secret options directly in Compose. Keep the database name,
user and passwords consistent with the existing database volume; changing the
files alone does not rotate MariaDB credentials.

## Accounts and first access

1. Choose **Create account** and enter username, email, password and confirmation.
2. Registration signs you in and creates your single profile, in English.
3. The first-access popup asks for first name, last name, main sport and language.
   Photo and Garmin API key are optional and can be added later.
4. Save the profile to enter the dashboard. Completion persists in MariaDB;
   future logins open the dashboard directly. Unfinished setup reopens the popup.
5. **My profile** edits the same profile. **Sign out** revokes the current session.

Usernames accept 3–40 ASCII letters, digits, dots, dashes or underscores. Email
and username uniqueness is case insensitive. Passwords accept 15–128 characters.
The server derives ownership from the signed in session; `X-Profile-Id` is ignored.
Email delivery, email verification and password reset are not implemented.

## Development in Docker

```bash
npm run dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173). `compose.dev.yaml` uses the
development image, starts Express and Vite inside the app container, and watches
frontend/backend files for changes. Dependency changes rebuild the image. Vite
forwards API calls to Express inside the same container. Stop the foreground
command with Ctrl+C; `npm run docker:up` returns to the compiled application.

Development and the compiled app use the same MariaDB volume and secrets, so
accounts and profiles persist when switching modes. Port 8080 serves the API in
development; the frontend is served by Vite on 5173. Free those ports before
starting if older local processes are still using them.

## Dashboard

- Create, complete, reopen and delete workout sessions in the weekly planner.
- Review training load across two complete months. Arrows move by two months;
  **Current** returns to the previous/current pair. Fixed colour bands reflect
  completed training hours; planned and future sessions do not contribute.
- Preview wellness charts and a complete sample plan. Preview changes stay in
  browser memory and never modify your account's sessions.
- Choose English, Italian, French, Spanish or German in your profile. Changes
  preview instantly; saving persists them. Catalogs are in `langs/`; the shared
  utility `frontend/src/lib/i18n.js` serves React, dates and translated errors.
- Choose among six themes in settings. Cancelling restores saved preferences.

Real Garmin measurement import is still pending. Wellness charts are empty
outside preview. Training plans are not sent to Garmin devices. A saved Garmin
key enables token preparation and renewal independently of the planner.

## MariaDB and secrets

Tables: `users`, `profiles`, `auth_sessions`, `planned_sessions` and
`schema_migrations`. `profiles.user_id` is unique and references `users.id`.
Registration creates the user and profile in one transaction. Schema updates
live in `db/migrations/mariadb/` and run automatically at startup.

| Host file | Container secret | Access |
| --- | --- | --- |
| `data/secrets/db_password` | `/run/secrets/db_password` | App and MariaDB |
| `data/secrets/db_root_password` | `/run/secrets/db_root_password` | MariaDB and temporary integration tests |
| `data/encryption.key` | `/run/secrets/encryption_key` | App |

These files are private (mode 600), encrypted in Git with git-crypt, and excluded
from the image build context. Their unlocked working copies are readable locally.
The helper refuses to replace missing files in an incomplete secret set. Application
startup refuses a missing encryption key, even for an empty database.

- Passwords use salted scrypt hashes (N=32768, r=8, p=3), with constant-time
  verification. Confirmation is never stored. Parameters follow the
  [OWASP password storage guidance](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html).
- Username, email, first/last name, photo and Garmin key use AES-256-GCM encryption,
  bound to the record and field. Username/email lookup uses keyed HMAC indexes.
  Workout titles, notes, dates and durations are ordinary application data in MariaDB.
- Random session secrets live in HttpOnly, SameSite=Strict cookies. MariaDB stores
  token digests; sessions expire after seven days and logout revokes them.
- Writes require CSRF tokens. Cross-origin browser writes are rejected. Each app
  process rate limits login/signup attempts by IP.
- API responses are not cached and never return password hashes or Garmin secrets.

Back up **MariaDB, `data/secrets/` and `data/encryption.key`** together to a protected
location. A database-only backup cannot recover encrypted account information.
Use MariaDB's backup/dump tools for a consistent database backup. Normal container
updates preserve both the volume and files. Never remove the volume to update code.

The secret-file mounts use
[Docker Compose secrets](https://docs.docker.com/reference/compose-file/secrets/);
they are private files on the host, not an encrypted external secrets service.

## Unlocking secrets with git-crypt

The three installation secret files are allowlisted in `.gitignore` and encrypted
through `.gitattributes`. Everything else under `data/` stays ignored. The
git-crypt unlock key is separate from the application's `data/encryption.key`.

The local unlock key is `.local-keys/garmintrainer.git-crypt.key` (directory mode
700, file mode 600). This directory and `*.git-crypt.key` files are excluded from
Git and Docker images. Keep an additional protected copy outside this checkout,
for example in a password manager. Losing all copies prevents recovery after cloning.

On another machine or on the VPS, install git-crypt, transfer the key separately
and keep it outside the repository. Then run:

```bash
git-crypt unlock /secure/path/garmintrainer.git-crypt.key
git config --local core.hooksPath .githooks
chmod 600 data/secrets/db_password data/secrets/db_root_password data/encryption.key
npm run secrets:check
npm run docker:up
```

Docker startup refuses locked git-crypt files instead of passing encrypted bytes
to MariaDB. The pre-commit hook checks the staged blobs and attributes. The
pre-push hook checks every new commit, including intermediate commits, for plaintext
installation secrets or unlock keys. `npm run secrets:history` checks the current
branch's entire history; the GitHub workflow runs this without a decryption key.
These checks protect the declared secret paths and default unlock-key filenames;
they are not a general scanner for secrets copied into other source files.

```bash
git-crypt status -e
npm run secrets:check
```

When committing changed secrets, keep git-crypt unlocked and let Git's filters
encrypt them. Do not force-add the unlock key. Existing database credentials and
the data-encryption key must not be regenerated just to enable git-crypt.
Changes to branch access do not revoke previously shared decryption keys or
access to old encrypted commits. Keep production credentials distinct from local
development credentials when setting up the VPS.

## Deploy to the test VPS

The configuration is in `deploy/vps.json`: SSH host, local identity-file path,
remote installation directory and public domain. It currently targets
`ubuntu@gladiakvps.ovh` and `https://garmintrainer.gladiakvps.ovh`.
The SSH private key stays on your computer. Encrypted keys can be loaded into
your SSH agent first; the script uses non-interactive SSH and normal host-key
verification.

Requirements on your computer: Node.js, SSH/SCP and tar. On the VPS: Docker with
Compose, Python 3, and SSH access to a user allowed to run Docker. Docker is
already installed on the configured VPS. Point the domain's A record at
`51.83.45.39`; any AAAA record must also point to this VPS. Allow inbound TCP
ports 80 and 443 (and optionally UDP 443) in the VPS/provider firewall.

```bash
npm run deploy:vps             # First installation or update
npm run deploy:vps -- status   # Container status
npm run deploy:vps -- verify   # HTTPS, frontend, database health, protected API
npm run deploy:vps -- logs     # Follow the last 100 log lines; Ctrl+C to stop
npm run deploy:vps -- backup   # Database + keys in a private server archive
```

The script uploads an explicit list of application source files from your current
working copy, including uncommitted changes. It excludes Git metadata, local
data, dependencies and SSH/git-crypt keys. No GitHub access or git-crypt key is
needed on the server. It builds the image on the VPS before changing the running
containers. The first deployment generates independent database passwords and an
encryption key on the VPS; it starts with an empty database, so create a new account.

`deploy/compose.vps.yaml` runs MariaDB, the app and Caddy separately. Only Caddy
publishes ports. MariaDB uses an internal Docker network, and the app accepts
forwarded client IP/protocol headers from its single private proxy. Caddy
overwrites the client-IP header, obtains/renews TLS certificates and redirects
HTTP to HTTPS. See [Caddy's proxy documentation](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy).
Deployment waits for database/application health before checking HTTPS. Compose
updates preserve named volumes, as described in [Docker's deployment options](https://docs.docker.com/reference/cli/docker/compose/up/).

Server layout under `/home/ubuntu/garmintrainer`:

| Path | Contents |
| --- | --- |
| `current` | Link to the last successfully started release |
| `releases/<id>/` | Uploaded source code and deployment configuration |
| `shared/secrets/` | VPS-only database passwords and encryption key, mode 600 |
| `backups/<timestamp>.tar.gz` | Private SQL dump, secret files and release metadata |
| `deployment.json` | Public domain and current/previous release identifiers |

The project `garmintrainer-vps` owns the `mariadb_data`, `caddy_data` and
`caddy_config` named volumes. Every update first builds the new image and then
creates a database/keys backup; a failed backup stops the update. Files and
images from older releases are kept. The script never deletes volumes, runs
prune or replaces existing secret files. Concurrent deploys/backups are blocked.
Updates may briefly interrupt requests while containers restart.

If DNS is still propagating or certificate issuance fails, the containers remain
running and the command reports the failed HTTPS check. Correct DNS/firewall
settings, inspect logs, then rerun `verify`. If container startup fails, the
previous release link stays unchanged; inspect the failed command's release
directory on the server. No database restore or schema rollback is automatic.
Migrations can make an older image incompatible: restore the matching database
backup **and its secret files** when recovery requires rolling back the schema.

Backups contain decrypted database dumps and encryption keys. Keep server backup
permissions private and copy them to a protected location outside the VPS.
The backup command creates a consistent MariaDB dump; it does not stop active
writes or automatically copy archives off the server. TLS certificate state
persists in Caddy volumes and can be regenerated if needed.

Deployment safety checks:

```bash
python3 -B -m unittest discover -s test -p deploy_test.py
node --test test/config.test.js test/proxy.test.js
```

### Inspect the VPS database with phpMyAdmin

Open [phpMyAdmin](https://garmintrainer.gladiakvps.ovh/phpmyadmin/), using the
dedicated MariaDB username `dbviewer`. Deployment generates a random 43-character
password once in `shared/secrets/phpmyadmin_password` on the VPS, with mode 600,
and preserves it on updates. A local private copy is kept in
`.local-keys/vps-phpmyadmin.txt`, excluded from Git and deployment archives.
The password is never included in Compose, image layers or command arguments.

The account can read tables/views only in `garmintrainer`; it cannot modify data,
schema, database users or other databases. phpMyAdmin accepts only this account,
uses cookie authentication over HTTPS and blocks root/empty-password logins.
The container has no published port and reaches MariaDB over the private Docker
network. Caddy serves it under `/phpmyadmin/`, so no extra DNS record is required.
Configuration follows the [official Docker setup](https://docs.phpmyadmin.net/en/latest/setup.html#installing-using-docker)
and [account restrictions](https://docs.phpmyadmin.net/en/latest/config.html#cfg_Servers_AllowDeny_order).

Application-encrypted names, emails and credentials remain encrypted when viewed
directly in phpMyAdmin; the application decrypts those fields when displaying them.
Subsequent backups include the phpMyAdmin password with the other VPS secrets;
the deploy command recreates the dedicated account and its grants when restoring
a database into a fresh installation.

## Container settings

| Setting in Compose | Purpose |
| --- | --- |
| `HOST`, `PORT` | Backend bind address inside the container |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER` | MariaDB connection |
| `DB_PASSWORD_FILE` | Mounted database password secret |
| `ENCRYPTION_KEY_PATH` | Mounted encryption key secret |
| `COOKIE_SECURE` | Set `true` for HTTPS |
| `TRUST_PROXY_HOPS` | `0` locally; `1` only behind the private VPS proxy |
| `ALLOWED_ORIGINS` | Explicit extra origins allowed to write |
| `GARMIN_HTTP_TIMEOUT_MS` | Provider request timeout, default 20000 |
| `GARMIN_TOKEN_REFRESH_MARGIN_MS` | Early renewal, default 60000 |
| `GARMIN_PERSONAL_API_BASE_URL` | Base URL override for local simulations |

## Verification

```bash
npm ci
npm test
npm run test:mariadb
```

The fast suite uses a test-only in-memory repository and real HTTP Garmin fixtures
with synthetic accounts. It does not read installation credentials. Persistence,
transactions, encryption and account separation are verified separately using
the production MariaDB repository in a temporary Docker test container. That test
creates and removes its own uniquely named schema; it does not change app accounts.

Contracts: [account API](postman/account-api.md), [profile API](postman/local-profiles.md),
[Garmin authentication](postman/garmin-auth.openapi.json). The optional Postman
simulation is also available:

```bash
postman simulation run postman/simulations/garmin-auth.sim.yaml --port 4900 --output ndjson --no-history
npm run test:simulation
```

No real Garmin account is contacted by automated tests. Nothing is deployed to
the VPS by these commands.
