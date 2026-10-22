'use strict';

const { Router } = require('express');
const { InputError } = require('../libs/database');

function createGarminAuthRouter(garmin, requireProfile, getDatabase) {
  const router = Router();
  router.use(requireProfile);

  router.get('/status', (req, res) => {
    res.json(garmin.getClient(req.profile.id).getTokenStatus());
  });

  router.post('/ensure', async (req, res) => {
    const status = await garmin.getClient(req.profile.id).ensureToken();
    if (getDatabase().getProfile(req.profile.id).credentialRevision !== req.profile.credentialRevision) {
      throw new InputError('La chiave Garmin è cambiata durante l’attivazione. Aggiorna il profilo e riprova.', 409, 'PROFILE_CREDENTIAL_CHANGED');
    }
    res.json(status);
  });

  return router;
}

module.exports = { createGarminAuthRouter };
