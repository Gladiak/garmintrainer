'use strict';

const { Router } = require('express');
const { normalizeProfileAvatar } = require('../libs/avatar');

function createProfilesRouter({ getDatabase, garmin }) {
  const router = Router();
  router.get('/', (req, res) => res.json({ profiles: getDatabase().listProfiles() }));
  router.post('/', async (req, res) => res.status(201).json(getDatabase().createProfile(await normalizeProfileAvatar(req.body))));
  router.patch('/:id', async (req, res) => {
    const previous = getDatabase().getProfile(req.params.id);
    const profile = getDatabase().updateProfile(req.params.id, await normalizeProfileAvatar(req.body));
    if (previous.credentialRevision !== profile.credentialRevision) garmin.invalidate(profile.id);
    res.json(profile);
  });
  router.patch('/:id/theme', (req, res) => res.json(getDatabase().updateProfileTheme(req.params.id, req.body?.theme)));
  router.delete('/:id', (req, res) => {
    getDatabase().deleteProfile(req.params.id);
    garmin.invalidate(req.params.id);
    res.status(204).end();
  });
  return router;
}

module.exports = { createProfilesRouter };
