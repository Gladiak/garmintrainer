'use strict';

const { createDashboardMeasurements } = require('../helpers/dashboard-measurements');

function dashboardController({ garmin, getDatabase }) {
  const measurements = createDashboardMeasurements({ garmin, getDatabase });
  const pending = new Map();
  return {
    async read(req, res) {
      const profile = req.profile;
      const client = await garmin.getClient(profile.id);
      const snapshot = await measurements.read(profile, req.query);
      res.json({ profile, garmin: client.getTokenStatus(), storage: { ready: true, type: 'mariadb' },
        ...snapshot, sessions: await getDatabase().listSessions(profile.id) });
    },
    async sync(req, res) {
      const previous = pending.get(req.profile.id);
      let finished;
      const slot = new Promise(resolve => { finished = resolve; });
      pending.set(req.profile.id, slot);
      const controller = new AbortController();
      const close = () => { if (!res.writableEnded) controller.abort(); };
      res.on('close', close);
      try {
        if (previous) await previous;
        controller.signal.throwIfAborted();
        const snapshot = await measurements.sync(req.profile, req.body || {}, controller.signal);
        const client = await garmin.getClient(req.profile.id);
        res.json({ ...snapshot, garmin: client.getTokenStatus() });
      } finally {
        res.off('close', close);
        finished();
        if (pending.get(req.profile.id) === slot) pending.delete(req.profile.id);
      }
    },
  };
}

module.exports = { dashboardController };
