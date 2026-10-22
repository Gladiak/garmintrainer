# Local account API

MariaDB is the only persistence layer. Docker Compose supplies the connection
settings and mounts password/encryption files as secrets. The API behavior is
identical in the production and development containers.

All responses under `/api` are private and `no-store`. Errors use
`{ "error": { "code": "…", "message": "…", "messageKey": "…" } }`.

| Method | Path | Request / response |
| --- | --- | --- |
| POST | /api/auth/register | `{username,email,password,passwordConfirmation}` → 201 `{user,profile,csrfToken}` and session cookie |
| POST | /api/auth/login | `{username,password}` → 200 same session representation; invalid credentials → 401 |
| GET | /api/auth/session | Current session representation, or 401 |
| POST | /api/auth/logout | Revoke current session, clear cookie → 204 |
| GET | /api/profile | The signed in user's single profile |
| PATCH | /api/profile | Complete/update own profile: firstName, lastName, primarySport; optional language, theme, avatar, apiKey |
| PATCH | /api/profile/theme | `{theme}` updates only theme, including before onboarding |
| GET | /api/dashboard | `{profile,garmin,storage,measurements,sessions}` for the current account |
| GET, POST | /api/sessions | List or create own training sessions |
| PATCH, DELETE | /api/sessions/:id | Update status / remove own session; foreign or missing id → 404 |
| GET, POST | /api/garmin/auth/status, /api/garmin/auth/ensure | Existing Garmin contract, scoped to the authenticated account |

Registration requires username 3–40 ASCII letters, digits, dots, dashes or underscores,
email up to 254 characters, password 15–128 characters and exact confirmation.
Username and email uniqueness is case insensitive. Invalid fields → 400; duplicate
username/email → generic 409 `ACCOUNT_EXISTS`. Login failures never identify which
field failed. Authentication endpoints have an IP based attempt limit → 429.

Registration atomically creates one user and one incomplete profile (English default).
`profile.needsCompletion` remains true until firstName, lastName and primarySport
are saved. The UI opens onboarding on every login while this is true. Garmin key
and photo are optional. No API can create, switch or delete profiles independently.
`X-Profile-Id` is ignored: identity always comes from the session cookie.

The session cookie is HttpOnly, SameSite=Strict, path=/, expires after seven days;
Secure is enabled with COOKIE_SECURE=true (required for HTTPS deployment).
Session secrets are random, stored only as SHA-256 digests. All authenticated
mutations require the `X-CSRF-Token` from the session response (403 if absent or
incorrect). Browser cross-origin mutations are rejected, including login/signup;
ALLOWED_ORIGINS explicitly permits local Vite origins when needed.

Passwords use salted scrypt hashes (N=32768,r=8,p=3). Username, email, profile names,
photo and Garmin credentials use AES-256-GCM; unique lookup indexes use keyed HMAC.
Keep the separate data/encryption.key file with database backups. Password confirmation
is never persisted. Neither credential material nor hashes are returned by the API.
