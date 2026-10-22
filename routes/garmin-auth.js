"use strict";

const { Router } = require("express");
const { InputError } = require("../libs/validation");

function createGarminAuthRouter(garmin, getDatabase) {
  const router = Router();

  router.get("/status", async (req, res) => {
    res.json((await garmin.getClient(req.profile.id)).getTokenStatus());
  });

  router.post("/ensure", async (req, res) => {
    const status = await (await garmin.getClient(req.profile.id)).ensureToken();
    if (
      (await getDatabase().getProfile(req.profile.id)).credentialRevision !==
      req.profile.credentialRevision
    ) {
      throw new InputError(
        "La chiave Garmin è cambiata durante l’attivazione. Aggiorna il profilo e riprova.",
        409,
        "PROFILE_CREDENTIAL_CHANGED",
      );
    }
    res.json(status);
  });

  return router;
}

module.exports = { createGarminAuthRouter };
