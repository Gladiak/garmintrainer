# Garmin Trainer

Garmin Trainer is a personal training dashboard for planning workouts and
reviewing training load. Each registered user has a private profile, a weekly
training plan and saved language and theme preferences.

## Features

- Create, complete, reopen and delete workout sessions in the weekly planner.
- Review recorded Garmin activity hours across two months, with colour bands
  that make activity time easy to compare. The local planner remains separate.
- Display real Garmin heart rate, HRV, Body Battery, stress and sleep summaries.
  Browse historical intervals and refresh the displayed data on demand.
- Keep imported measurements encrypted in MariaDB, including their dates and
  Garmin identifiers. Missing device measurements stay explicitly unavailable.
- Manage a personal profile with name, main sport, optional photo and Garmin key.
- Use English, Italian, French, Spanish or German and choose among six themes.
  Saved preferences persist across sessions.

## Project status

Account management, profiles and the workout planner persist in MariaDB.
A saved personal Garmin key enables automatic token preparation and import of
real dashboard measurements. First access retrieves 30 days of summaries;
subsequent navigation retrieves the needed intervals, and Refresh downloads the
displayed intervals again. The dashboard has no sample-data mode.
Training plans are not sent to Garmin devices.
Email delivery, email verification and password reset are not implemented.

## Technology

The frontend uses React and Vite, the API uses Node.js and Express, and MariaDB
stores accounts, profiles and workouts. Docker Compose runs the application and
database in separate containers and applies database migrations at startup.
The interface translation catalogs are in `langs/`. Garmin endpoint controllers
are in `controllers/`; shared transport, validation, normalization and encrypted
storage helpers are in `helpers/`. The public API catalog and design study are
in [API_SCHEMA.md](API_SCHEMA.md).

## Requirements

- Docker with Compose and support for `docker compose up --watch`.
- Node.js 22.12+ with npm for the local setup helper.
- git-crypt and the separately supplied unlock key for the encrypted local secrets.

## Local setup

From the project directory, unlock the local installation secrets after cloning:

```bash
git-crypt unlock /secure/path/garmintrainer.git-crypt.key
git config --local core.hooksPath .githooks
chmod 600 data/secrets/db_password data/secrets/db_root_password data/encryption.key
npm run secrets:check
```

Keep the unlock key outside Git. If all three secret files are absent on an
entirely new installation, the Docker helper generates them automatically.
Locked or incomplete secret sets must be unlocked or restored before startup.

## Development

Start Docker, then run:

```bash
npm run dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173) and create a local account.
Express, Vite and MariaDB run in containers; host dependencies are not required.
Frontend and backend changes are watched automatically, and dependency changes
rebuild the image. Stop the foreground command with Ctrl+C.

The frontend uses port 5173 and the API uses port 8080. MariaDB is available only
inside the Docker network. Local configuration is in `compose.yaml` and
`compose.dev.yaml`.

Useful commands:

```bash
npm run docker:logs   # Follow container logs
npm run docker:down   # Stop containers; preserve database and secrets
npm run docker:up     # Build/start the compiled app at http://127.0.0.1:8080
```

Development and the compiled app share the local database volume and secrets.
Database migrations run automatically at startup.

## First access

1. Choose **Create account** and enter a username, email, password and confirmation.
2. Complete the profile with first name, last name, main sport and language.
   A photo and Garmin key are optional.
3. Save the profile to enter the dashboard and start planning workouts.

**My profile** lets you update the same profile later. **Sign out** ends the
current session. An unfinished profile setup reopens on the next login.

## Local checks

```bash
npm ci
npm test
npm run test:mariadb
```

The MariaDB integration checks require Docker and use a temporary test schema.
