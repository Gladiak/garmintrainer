"use strict";

const { Router } = require("express");

function createDashboardRouter({ garmin, getDatabase }) {
  const router = Router();
  router.get("/dashboard", async (req, res) => {
    const database = getDatabase();
    const profile = req.profile;
    const client = await garmin.getClient(profile.id);
    res.json({
      profile,
      garmin: client.getTokenStatus(),
      storage: { ready: true, type: "mariadb" },
      measurements: { state: "not_imported", lastSyncAt: null, daily: [] },
      sessions: await database.listSessions(profile.id),
    });
  });
  router.get("/sessions", async (req, res) =>
    res.json({ sessions: await getDatabase().listSessions(req.profile.id) }),
  );
  router.post("/sessions", async (req, res) =>
    res
      .status(201)
      .json(await getDatabase().createSession(req.profile.id, req.body)),
  );
  router.patch("/sessions/:id", async (req, res) => {
    res.json(
      await getDatabase().setSessionStatus(
        req.profile.id,
        req.params.id,
        req.body?.status,
      ),
    );
  });
  router.delete("/sessions/:id", async (req, res) => {
    await getDatabase().deleteSession(req.profile.id, req.params.id);
    res.status(204).end();
  });
  return router;
}

module.exports = { createDashboardRouter };
