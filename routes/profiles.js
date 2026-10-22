"use strict";
const { Router } = require("express");
const { normalizeProfileAvatar } = require("../libs/avatar");
function createProfilesRouter({ getDatabase, garmin }) {
  const router = Router();
  router.get("/", (req, res) => res.json(req.profile));
  router.patch("/", async (req, res) => {
    const profile = await getDatabase().updateProfile(
      req.profile.id,
      await normalizeProfileAvatar(req.body),
    );
    if (req.profile.credentialRevision !== profile.credentialRevision)
      garmin.invalidate(profile.id);
    res.json(profile);
  });
  router.patch("/theme", async (req, res) =>
    res.json(
      await getDatabase().updateProfileTheme(req.profile.id, req.body?.theme, req.body?.darkMode),
    ),
  );
  return router;
}
module.exports = { createProfilesRouter };
