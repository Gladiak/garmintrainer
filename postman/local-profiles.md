# Profile API

The public multi-profile testing API has been replaced by authenticated accounts.
See [the account API contract](account-api.md) for registration, login, session
cookies, CSRF, ownership and the single-profile endpoints.

`GET /api/profile` and `PATCH /api/profile` address only the signed in user's
profile. There are no profile lists, arbitrary profile identifiers, creation,
switching or deletion endpoints. `X-Profile-Id` has no effect.

Profile updates require firstName, lastName and primarySport. Names are limited
to 80 characters each. Sports: running, cycling, swimming, gym, hiit. Garmin
apiKey, avatar, theme and language are optional; omission preserves saved values.
An empty API key preserves the existing credential; `apiKey: null` removes it.
Keys never appear in responses. Updating a key invalidates that account's Garmin
cache; changes to language/theme/photo do not.

Language accepts en (default), it, fr, es, de. Invalid values return
400 INVALID_LANGUAGE without partial updates. The browser previews changes
instantly and saves them with the profile. Cancellation restores the saved
language. Theme updates also support `PATCH /api/profile/theme` before onboarding.

Avatar input accepts JPEG/PNG/WebP data URLs up to 5 MiB. The server validates
and recodes to 256×256 WebP, removes metadata, then encrypts the result in MariaDB.
The profile JSON parser accepts up to 7 MiB; other endpoints retain a 32 KiB limit.

An incomplete profile opens the first-access popup automatically. Required fields
must be saved to dismiss it; Garmin key and photo can be added later. Completing
the profile persists across sessions and restarts. The same form remains available
under My profile without creating another profile.

After a dashboard load, the browser prepares Garmin access in the background if
a key exists and a token is missing or due for renewal. This uses the session
cookie and CSRF token. Provider failures appear separately and do not undo local
saves. Aborted or stale responses cannot replace the current screen state.
