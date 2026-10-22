# Local profile management contract

All routes are local to this Express installation, below `/api`. Profiles are
local workspaces, not authenticated user accounts. Responses never include the
stored Garmin key or access token.

| Method and path | Input | Success | Errors and side effects |
| --- | --- | --- | --- |
| `GET /profiles` | None | `200 { profiles: [...] }`, in creation order | Metadata includes names, sport, avatar, theme and `hasGarminKey`. |
| `POST /profiles` | Required `firstName`, `lastName`, `primarySport`; optional `avatar`, `apiKey`, `theme` | `201` profile metadata | Invalid fields: `400`; does not contact Garmin. |
| `PATCH /profiles/:id` | Same required fields as creation; optional fields preserve saved values when omitted | `200` updated metadata | Missing profile: `404 PROFILE_NOT_FOUND`; changing/removing a key invalidates only that profile's token cache. |
| `PATCH /profiles/:id/theme` | `{ "theme": "sage-ivory" }` or another ID from `libs/themes.json` | `200` updated metadata | Invalid/missing theme: `400 INVALID_THEME`; missing profile: `404 PROFILE_NOT_FOUND`. Changes only theme and update time, including for incomplete legacy profiles. Credentials and token cache remain unchanged. |
| `DELETE /profiles/:id` | None | `204`, empty body | Missing profile: `404 PROFILE_NOT_FOUND`. Atomically removes that profile and its local sessions, avatar and encrypted Garmin key; invalidates only its token cache. No Garmin request. |

The browser owns the active profile selection. Editing an inactive profile does
not activate it; creating a profile selects it. Deleting the current profile
selects the first remaining profile, or clears the selection if none remain.
Deleting another profile preserves the current selection. UI deletion requires
an explicit confirmation in the profile popup. Theme previews are temporary
until settings are saved; cancel restores the persisted theme.

## Automatic Garmin access in the browser

After loading the current profile's dashboard (startup, selection, refresh or
saving the active profile), the browser calls `POST /garmin/auth/ensure` with
`X-Profile-Id` if Garmin is configured and the token is missing, expired or due
for renewal (`refreshRequired`). The endpoint returns token status only, never
the key or token. It reuses the existing per-profile cache and renewal logic.
Profile creation/update endpoints still persist locally without calling Garmin.

Preparation runs in the background and does not delay the local dashboard or
make a saved profile appear unsaved if Garmin fails. Errors appear separately
from database/backend errors; another dashboard refresh or profile selection
retries once, without an automatic retry loop. Changing profiles or saving a
replacement key cancels the previous browser request, and late results cannot
replace the current profile's status. Inactive profiles are prepared when selected.
