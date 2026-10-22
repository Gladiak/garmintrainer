'use strict';

const { Router } = require('express');

function createDashboardRouter({ garmin, getDatabase, requireProfile }) {
  const router = Router();
  router.get('/dashboard', (req, res) => {
    const database = getDatabase();
    const profileId = req.get('X-Profile-Id');
    const profile = profileId ? database.getProfile(profileId) : null;
    res.json({
      profiles: database.listProfiles(), profile,
      garmin: profile ? garmin.getClient(profile.id).getTokenStatus() : null,
      storage: { ready: true, type: 'sqlite' },
      measurements: { state: 'not_imported', lastSyncAt: null, daily: [] },
      sessions: profile ? database.listSessions(profile.id) : [],
    });
  });
  router.get('/sessions', requireProfile, (req, res) => res.json({ sessions: getDatabase().listSessions(req.profile.id) }));
  router.post('/sessions', requireProfile, (req, res) => res.status(201).json(getDatabase().createSession(req.profile.id, req.body)));
  router.patch('/sessions/:id', requireProfile, (req, res) => {
    res.json(getDatabase().setSessionStatus(req.profile.id, req.params.id, req.body?.status));
  });
  router.delete('/sessions/:id', requireProfile, (req, res) => {
    getDatabase().deleteSession(req.profile.id, req.params.id);
    res.status(204).end();
  });
  return router;
}

module.exports = { createDashboardRouter };
