"use strict";

const { Router } = require("express");
const { dashboardController } = require("../controllers/dashboard");

function createDashboardRouter({ garmin, getDatabase }) {
  const router = Router();
  const controller = dashboardController({ garmin, getDatabase });
  router.get('/dashboard', controller.read);
  router.post('/garmin/sync', controller.sync);
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
