# Garmin Trainer

Garmin Trainer is a personal training dashboard for planning workouts and
reviewing training load. Each registered user has a private profile, a weekly
training plan and saved language and theme preferences.

## Features

- Create, complete, reopen and delete workout sessions in the weekly planner.
- Review Garmin activity hours over the selected dates, with daily totals and
  activity details. The local planner remains separate.
- Open Overview on today and browse one day at a time: heart rate, HRV, Body
  Battery, stress, sleep, steps and daily training information.
- Explore Wellbeing over 1/7/14/30 days: recovery, HRV status and personal baseline,
  sleep score, stress, respiration and SpO₂, when reported by your device.
- Compose Overview and Wellbeing in Settings using a four-column grid: drag
  components from the filtered library, move and resize them, or remove them
  with the trash icon. Each component has minimum dimensions. The editor shows
  names only and supports keyboard controls; changes apply on Save. Settings
  keep the same size across sections. The weekly planner has its own page.
- Keep imported measurements encrypted in MariaDB, including their dates and
  Garmin identifiers. Missing device measurements stay explicitly unavailable.
- Manage a personal profile with name, main sport, optional photo and Garmin key.
- Use English, Italian, French, Spanish or German and choose among six themes.
  Enable dark mode without changing theme accents or data colors.
  Saved preferences persist across sessions.

## Project status

Account management, profiles and the workout planner persist in MariaDB.
A saved personal Garmin key enables automatic token preparation and import of
real dashboard measurements. First access retrieves only the day and sources
needed by the modules of the open section. Navigation retrieves the selected intervals, and
Refresh downloads their data again. Stress uses daily aggregates; detailed activity
tooltips use search summaries without downloading activity files. The dashboard has no sample-data mode.
Views following today advance at midnight in the Garmin timezone, including after
standby. Historical selections stay fixed. Days with no synced device data are a
neutral empty state; manual refresh can check them again.
The Fitness and recovery panel combines sleep quality, nightly HRV and Garmin's
personal baseline, Body Battery, stress and reference heart rate. It retrieves
7 nights of sleep, 8 days of wellness summaries and 28 days of activities for
weekly activity load comparisons and the latest VO₂ max reading. Comparisons
show dates and data coverage; VO₂ max compares separate dates in the same sport.
Missing measurements stay unavailable. Activity load is the sum of available
activity values, not Garmin's acute load or native Training Status.
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

## Dashboard component library

`shared/dashboard-modules.json` defines each integrated component, its API resources,
allowed pages and `grid` dimensions (`w`, `h`, `minW`, `minH`, `maxW`, `maxH`).
`frontend/src/components/dashboard/ModuleLibrary.jsx` binds these definitions to
standard summary cards and data panels. Add a new renderer and its normalized
resources before exposing another API capability in the library.

`shared/dashboard-grid.mjs` owns placement, collision handling and responsive
reflow. Layout v3 stores `{id, type, x, y, w, h}` for each component in
`sections.overview` and `sections.wellness`. The API validates integer coordinates,
component minima, page eligibility, unique types per page and non-overlap. Old
layouts migrate deterministically, retaining the first instance of duplicate types.
The database continues to store the encrypted layout payload without a schema change.

The editor uses Pointer Events for mouse, pen and touch, with edge scrolling and
Escape to cancel. Clicking a library item also adds it; arrow keys move a focused
component, arrow keys on its corner handle resize it, and Delete removes it.
Only Save persists the draft. The four-column desktop geometry is shared with the
actual pages; narrower containers derive a two- or one-column arrangement without
overwriting saved positions. Editor interactions do not request Garmin data.

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
