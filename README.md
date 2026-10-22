# Garmin Trainer

A personal training dashboard for planning your week, managing local athlete profiles, and preparing to bring Garmin wellness data into one place.

Garmin Trainer combines a responsive React interface with an Express backend and a local SQLite database. Each profile has its own training plan, appearance, and optional Garmin credentials. The training planner works independently of Garmin, so you can start organizing workouts without connecting an account.

## Features

- **Weekly training planner.** Create sessions with a sport, date, optional start time, duration, and notes. Mark sessions as completed, return them to planned, or remove them.
- **Separate local profiles.** Search, select, edit and delete athletes with independent plans, Garmin credentials, profile photos, and saved themes on shared grayscale surfaces.
- **Five interface languages.** English (default), Italian, French, Spanish, and German, saved per profile and switched instantly.
- **Garmin authentication.** Save a personal API key for a profile and let the backend obtain, cache, and renew its temporary access token.
- **Monthly training load.** Two Nivo calendar heatmaps show complete months side by side, with navigation that moves two months at a time. Hours come from completed sessions in the selected profile's local plan.
- **Interactive dashboard preview.** Explore wellness charts, a sample weekly training plan and populated training-load calendars. Try creating, completing and deleting demo sessions in memory.
- **Local persistence.** Keep profiles and sessions in SQLite, with no separate database service to install.
- **Responsive interface.** Use the dashboard and training planner on desktop or mobile.

## Current status

The local training planner, profile management, and Garmin authentication are implemented. **Importing real Garmin measurements is not implemented yet.** Wellness cards and charts remain empty unless you enable the clearly marked preview mode; preview values are never saved to the database.

Training plans belong to this application and are not sent to a Garmin device. Session completion is recorded manually and is not matched against Garmin activities. The interface defaults to English and follows the selected profile's language.

The next development step is per-profile Garmin data import and history, starting with daily summaries, sleep, HRV, Body Battery, and stress.

## Technology

| Layer | Technology |
| --- | --- |
| Interface | React, Vite, Lucide icons |
| Charts | Nivo |
| Backend | Node.js, Express |
| Local storage | SQLite through `better-sqlite3` |
| Profile images | Sharp |
| Credential protection | AES-256-GCM encryption; access tokens held in memory |
| Tests | Node.js test runner, local HTTP fixtures, optional Postman simulation |

## Run locally

### 1. Prerequisites

- **Node.js 22.12.0 or later**, with npm.
- A clone or downloaded copy of this repository.
- An optional Garmin Personal API key to activate Garmin access. No key is required for the local planner or dashboard preview.

Run all commands below from the repository root. Frontend and backend dependencies are installed together; no separate installation is needed inside `frontend/`.

### 2. Install dependencies

```bash
npm ci
```

### 3. Configure the installation

The defaults are sufficient to run locally. To customize them, create a configuration file:

```bash
cp .env.example .env
```

If you already have a `.env` file, edit it instead of replacing it. Keep Garmin API keys in local profiles through the application interface; `.env` is for installation settings only.

### 4. Start the development servers

```bash
npm run dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173).

This command starts both services with automatic reload:

| Service | Default address |
| --- | --- |
| React dashboard | [http://127.0.0.1:5173](http://127.0.0.1:5173) |
| Express backend | [http://127.0.0.1:3000](http://127.0.0.1:3000) |

Vite forwards `/api` requests to Express. SQLite and its schema are created automatically when the backend starts. Press **Ctrl+C** to stop both services.

### 5. Create your first profile

1. Open **Profili** from the sidebar or the avatar in its footer, then choose **Nuovo profilo**.
2. Enter your first name, last name, and primary sport: running, cycling, swimming, gym, or HIIT.
3. Optionally upload a JPG, PNG, or WebP profile photo, up to 5 MiB.
4. Leave the Garmin key empty to use the local planner, or enter your personal API key. Save the profile.
5. If you added a key, Garmin access is prepared automatically in the background for the current profile. The same check runs on startup, profile selection and dashboard refresh; no activation button is needed.

You can now add sessions to the weekly plan or enable the dashboard preview to explore the complete interface. Activating Garmin access prepares authentication only; it does not import measurements.

### Explore the preview

**Explore a preview** switches wellness cards/charts, **Your plan**, and **Monthly
training load** to sample data. The plan includes several months of completed
training, rest days and upcoming planned sessions, so the calendar displays all
load intensities and the weekly navigator has workouts to explore.

Create sessions, mark them completed or planned, and delete them to test the
interface. The calendar and its totals update immediately. Preview actions are
handled entirely in browser memory and never call the session write endpoints.
They are available even without a local profile or while the backend is
unavailable. Demo titles and notes follow the interface language; custom text
stays as entered. Both training panels are clearly marked **PREVIEW**.

**Close preview** restores the selected profile's real plan and discards the
temporary changes. Reopening it starts with fresh sample data. Switching
profiles exits preview and also closes any session form or deletion dialog.

Additional profiles keep their own plans and preferences. When editing a profile, leaving the key field empty preserves the saved credential. Enter a new key to replace it, or use the removal checkbox to delete it.

If Garmin rejects the key or cannot be reached, a separate dashboard message offers a retry while the saved profile and local planner remain available. Inactive profiles connect when selected. The profile popup keeps its title and close button fixed above a divider; only its content scrolls.

The profile popup has a search field and a **Nuovo profilo** button at the top. Selecting a row changes the active profile and marks it **Corrente**. Pencil and trash actions edit or delete the corresponding profile. Creation and editing share the same form and dialog state. Editing an inactive profile preserves the current selection; creating one selects it. Deletion requires confirmation and removes only that profile's local plan, photo and credential. If the current profile is deleted, the first remaining profile is selected, or the dashboard returns to its empty state.

### Review monthly training load

The **Training load** calendar sits beside the local training plan, replacing
the Garmin connection and local-storage information cards. The wellness trend
and sleep charts remain in their original positions. The previous and current
months open side by side by default. Each arrow moves the pair backward or
forward by two months; **Current** returns to the initial pair. Navigation works
across year boundaries. Every day of both months is visible immediately, including rest days and future dates,
with no scrolling inside the calendar. The Nivo TimeRange component from
`@nivo/calendar` supplies the daily cells, with localized month/day labels and
tooltips. The summary and daily details cover both displayed months.

The calendar sums the durations of sessions manually marked **completed** in the
local plan. Planned and future sessions do not contribute. The colour scale is
fixed across periods: no training, less than 1 hour, 1–2 hours, 2–3 hours, and 3
hours or more. More training hours means a darker shade of the profile's theme.
The summary shows total time, active days, and completed session count; **View
daily details** provides an accessible table. Completing, reopening, adding, or
deleting a session updates the calendar immediately. In preview, the calendar
uses the same temporary demo sessions shown in the weekly plan.

### Choose a language

Open **Profiles**, create or edit a profile, and choose **Language**: English,
Italian, French, Spanish, or German. New and existing profiles default to English.
For the active or a new profile, changing the selector previews the language
immediately across the dashboard and open dialog. **Save profile** persists it;
**Cancel**, closing the dialog, or Escape restores the active profile's saved
language. Editing an inactive profile leaves the interface in the current
profile's language until that profile is selected.

Dates, weekdays, chart labels, tooltips, accessible labels, notifications and
validation errors follow the language. Names, workout titles and notes remain
as entered. With no selected profile, the app uses English. The selected profile's
language is cached in the browser for startup and confirmed by the saved profile.

Translation catalogs live in [`langs/`](langs/): `en.json`, `it.json`, `fr.json`,
`es.json`, and `de.json`. The shared `languages.json` lists supported codes and
regional locales. Add text under the same key in every catalog; `{name}` style
placeholders are interpolated as plain text, and `.one`/`.other` keys support
plural counts. Missing translations fall back to English.

[`frontend/src/lib/i18n.js`](frontend/src/lib/i18n.js) centralizes translation,
instant switching, temporary previews, and document language/title updates.
React components subscribe through `useTranslation()` and render `t('key')`;
non-React helpers can use `t`, `getLanguage`, and `setLanguage` from the same
utility. Permanent changes are saved through the profile API using `language`.
Migration `005-profile-language.sql` preserves existing profiles and plans.

### Choose a theme

Open **Impostazioni** in the sidebar for theme settings. The selector offers six options with descriptive Italian names, an accent swatch, and a strip of the reference colours: **Salvia e avorio**, **Blu ardesia**, **Arancio sportivo**, **Rosa malva**, **Giallo vaniglia**, and **Petrolio e oro**.

All options share the same light grayscale backgrounds and panels. Accents colour active navigation, buttons, selections, focus indicators and data visualizations. Text on accent backgrounds adapts for contrast, including pale yellows. Selecting an option previews it immediately. **Salva impostazioni** persists the choice in SQLite for the current profile; **Annulla**, closing the popup, or pressing Escape restores the saved theme. Switching profiles and restarting the application restore the saved choice.

`libs/themes.json` defines the shared palette catalog; `libs/theme-interface.json` defines the grayscale surfaces. The frontend derives interface accents, CSS data tokens and Nivo colours through `frontend/src/lib/palette.js`. The profile API accepts an optional `theme` ID: `sage-ivory`, `slate-night`, `ember-night`, `mauve-dusk`, `vanilla-pastel`, or `ocean-gold`. Omission preserves the current choice on update; invalid IDs or `null` return `400 INVALID_THEME`. Existing profiles receive `sage-ivory` through migration `004-profile-theme.sql`. Theme changes do not invalidate Garmin tokens. Separate theme updates and profile deletion are documented in the [local profile contract](postman/local-profiles.md).

### Run the compiled application

To serve the built frontend directly from Express:

```bash
npm run build
npm start
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). The build is written to `dist/`; rebuild after changing frontend code.

### Available commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the backend and frontend together with automatic reload |
| `npm run dev:server` | Start only Express with file watching |
| `npm run dev:client` | Start only the Vite development server |
| `npm run build` | Build the frontend into `dist/` |
| `npm start` | Start Express and serve an existing frontend build |
| `npm run preview` | Preview the frontend build at `http://127.0.0.1:4173`; run Express separately for API requests |
| `npm test` | Run the automated test suite |
| `npm run test:simulation` | Run the smoke test against an already running Postman simulation |

### Configuration reference

| Variable | Default | Purpose |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Backend listening address |
| `PORT` | `3000` | Backend port; also used by the Vite API proxy |
| `DATABASE_PATH` | `./db/garmintrainer.sqlite` | SQLite file, relative to the repository root or an absolute path |
| `GARMIN_HTTP_TIMEOUT_MS` | `20000` | Timeout for Garmin HTTP requests, in milliseconds |
| `GARMIN_TOKEN_REFRESH_MARGIN_MS` | `60000` | Advance renewal window for access tokens, in milliseconds |
| `GARMIN_PERSONAL_API_BASE_URL` | `https://personal.connectapi.garmin.com` | Base URL override for simulations; plain HTTP is allowed only on loopback |

## Local data and credentials

The default database is `db/garmintrainer.sqlite`. Schema migrations in [`db/migrations/`](db/migrations/) run automatically at startup. Profiles, photos, theme choices, and training sessions persist across restarts. No sample sessions or wellness measurements are inserted into your database.

Garmin API keys are encrypted in SQLite. The installation encryption key is generated when needed in `db/garmintrainer.sqlite.key`, or `<DATABASE_PATH>.key` for a custom database location. **Keep both the database and its encryption key in a protected backup to restore saved Garmin credentials.** For a consistent backup of a running database, use the SQLite driver's backup API; otherwise stop the application before copying its data files.

Temporary Garmin access tokens stay in backend memory and are lost on restart. The backend obtains and renews them on demand. Saved API keys and access tokens are not returned by the application's API. The browser stores the selected profile ID and a theme cache, not Garmin credentials. Do not place secrets in `VITE_*` variables, which are exposed to frontend code.

Local profiles organize data within one installation; they do not provide user authentication or access control. The backend listens on loopback by default and is intended for personal local use. Add authentication and access controls before exposing it to a network.

The `.env` file, local database files, encryption keys, dependencies, and generated builds are excluded from Git.

For older installations, startup with the default database migrates legacy `GARMIN_API_KEY` or `GARMIN_PERSONAL_API_KEY` entries from `.env` into an encrypted initial profile and removes those entries after saving. Complete that profile's name and sport in the interface. A custom `DATABASE_PATH` does not import the main installation's legacy credentials.

## Verification

Run the automated tests:

```bash
npm test
```

The suite covers local persistence, profile separation, credential encryption and migration, avatar validation, language defaults and migration, live switching and translation catalog consistency, and Garmin token handling against local HTTP fixtures. It uses test credentials, does not read `.env`, and does not contact a real Garmin account. Postman is not required for this command.

For an additional simulation check, with the Postman CLI available, start the bundled simulation:

```bash
postman simulation run postman/simulations/garmin-auth.sim.yaml --port 4900 --output ndjson --no-history
```

Then, in another terminal:

```bash
npm run test:simulation
```

This checks token issuance and renewal after a rejected token using the local simulator and an in-memory database.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| The dashboard reports that the backend is unavailable | Keep `npm run dev` running, or start Express separately if using `dev:client` or `preview`. |
| Port `5173` or `4173` is already in use | Stop the process using that port; Vite is configured to require its specified port. |
| Backend port `3000` is already in use | Set a free `PORT` in `.env` and restart the services. Use that port when opening the compiled application. |
| Wellness cards remain empty after Garmin activation | Real measurement import is not implemented yet. Enable preview mode to view example charts. |
| Garmin access fails | Check the selected profile's key and network connection. Replace an expired or revoked personal API key in profile settings. |
| Saved Garmin credentials cannot be decrypted | Restore the matching database encryption key or re-enter the Garmin key in the affected profile. |

## Project structure

```text
app.js                      Express application and startup
frontend/                   React dashboard, components, styles, and assets
langs/                      English, Italian, French, Spanish and German catalogs
libs/                       Database, configuration, credentials, and Garmin client
libs/themes.json            Shared theme definitions
routes/                     Local profile, dashboard, session, and authentication routes
db/migrations/              Versioned SQLite schema migrations
scripts/dev.mjs             Combined development server launcher
test/                       Automated tests and simulation smoke test
postman/                    Garmin authentication contract and local simulation
vite.config.mjs             Frontend build and development proxy settings
```

For Garmin integration details, see the existing [Garmin Personal Data API reference](garmin_personal_data_api.md) and the [authentication contract](postman/garmin-auth.openapi.json).
