"use strict";

const path = require("node:path");
const express = require("express");
const { readConfig } = require("./libs/config");
const { createGarminProfileManager, getGarminProfileManager, GarminApiError } = require("./libs/garmin");
const { createGarminAuthRouter } = require("./routes/garmin-auth");
const { getDatabase, InputError } = require("./libs/database");
const { createDashboardRouter } = require("./routes/dashboard");
const { createProfilesRouter } = require("./routes/profiles");
const { migrateLegacyCredentials } = require("./libs/legacy-credentials");

function createApp({ garminManager, databaseProvider = getDatabase } = {}) {
  const garmin = garminManager || (databaseProvider === getDatabase ? getGarminProfileManager() : createGarminProfileManager({ databaseProvider }));
  const requireProfile = (req, res, next) => {
    const id = req.get("X-Profile-Id");
    if (!id) throw new InputError("Seleziona un profilo locale.", 409, "PROFILE_REQUIRED");
    req.profile = databaseProvider().getProfile(id);
    next();
  };
  const app = express();
  app.disable("x-powered-by");
  app.use("/api", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  app.use("/api/profiles", express.json({ limit: "7mb" }));
  app.use(express.json({ limit: "32kb" }));
  app.locals.garmin = garmin;

  app.get("/health", (req, res) => {
    res.json({ status: "ok", service: "garmintrainer" });
  });

  app.use("/api/profiles", createProfilesRouter({ garmin, getDatabase: databaseProvider }));
  app.use("/api/garmin/auth", createGarminAuthRouter(garmin, requireProfile, databaseProvider));
  app.use("/api", createDashboardRouter({ garmin, getDatabase: databaseProvider, requireProfile }));
  app.use(express.static(path.join(__dirname, "dist")));

  app.use((req, res) => {
    res
      .status(404)
      .json({ error: { code: "NOT_FOUND", message: "Risorsa non trovata." } });
  });

  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error instanceof InputError) {
      return res.status(error.statusCode).json({ error: { code: error.code, message: error.message, ...(error.messageKey ? { messageKey: error.messageKey } : {}) } });
    }
    if (error instanceof GarminApiError) {
      return res.status(error.statusCode).json({
        error: {
          code: error.code,
          message: error.message,
          upstreamStatus: error.upstreamStatus,
        },
      });
    }
    const invalidJson = error.type === "entity.parse.failed";
    const tooLarge = error.type === "entity.too.large";
    res.status(invalidJson ? 400 : tooLarge ? 413 : 500).json({
      error: {
        code: invalidJson
          ? "INVALID_JSON"
          : tooLarge
            ? "PAYLOAD_TOO_LARGE"
            : "INTERNAL_ERROR",
        message: invalidJson
          ? "JSON non valido."
          : tooLarge
            ? "Richiesta troppo grande."
            : "Errore interno.",
      },
    });
  });

  return app;
}

function startServer() {
  require("dotenv").config({ path: path.join(__dirname, ".env"), quiet: true });
  const config = readConfig();
  const database = getDatabase();
  // A test or secondary installation with a different DB must never claim the main .env key.
  if (config.databasePath === path.join(__dirname, "db", "garmintrainer.sqlite")) {
    migrateLegacyCredentials(database, path.join(__dirname, ".env"));
  }
  delete process.env.GARMIN_API_KEY;
  delete process.env.GARMIN_PERSONAL_API_KEY;
  const server = createApp().listen(config.port, config.host, () => {
    console.log(
      `Garmin Trainer disponibile su http://${config.host}:${config.port}`,
    );
  });
  server.on("error", (error) => {
    console.error(
      `Avvio del server non riuscito (${error.code || "SERVER_ERROR"}).`,
    );
    process.exitCode = 1;
  });
  const shutdown = () => server.close(() => database.close());
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  return server;
}

if (require.main === module) {
  try {
    startServer();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { createApp, startServer };
