"use strict";

const path = require("node:path");
const express = require("express");
const { readConfig } = require("./libs/config");
const { createGarminProfileManager, GarminApiError } = require("./libs/garmin");
const { createGarminAuthRouter } = require("./routes/garmin-auth");
const { InputError } = require("./libs/validation");
const { getMariaDatabase, initializeDatabase } = require("./libs/mariadb");
const { createAuthentication } = require("./libs/auth");
const { createDashboardRouter } = require("./routes/dashboard");
const { createProfilesRouter } = require("./routes/profiles");
const { createWorkoutsRouter } = require("./routes/workouts");

function createApp({ garminManager, databaseProvider = getMariaDatabase, config = readConfig() } = {}) {
  const garmin = garminManager || createGarminProfileManager({ databaseProvider, config: config.garmin });
  const auth = createAuthentication({ getDatabase: databaseProvider, cookieSecure: config.cookieSecure, allowedOrigins: config.allowedOrigins });
  const app = express();
  if (config.trustProxyHops) app.set("trust proxy", config.trustProxyHops);
  app.disable("x-powered-by");
  app.use("/api", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    res.set("X-Content-Type-Options", "nosniff");
    next();
  });
  app.use("/api", auth.sameOrigin);
  app.use("/api/profile", express.json({ limit: "7mb" }));
  app.use("/api/workouts", express.json({ limit: "192kb" }));
  app.use(express.json({ limit: "32kb" }));
  app.locals.garmin = garmin;

  app.get("/health", async (req, res) => {
    await databaseProvider().ready?.();
    res.json({ status: "ok", service: "garmintrainer" });
  });

  app.use("/api/auth", auth.router);
  app.use("/api", auth.requireUser);
  app.use("/api/profile", createProfilesRouter({ garmin, getDatabase: databaseProvider }));
  app.use("/api/garmin/auth", createGarminAuthRouter(garmin, databaseProvider));
  app.use("/api", createDashboardRouter({ garmin, getDatabase: databaseProvider }));
  app.use('/api', createWorkoutsRouter({ getDatabase: databaseProvider }));
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
      if (error.retryAt) res.set('Retry-After', String(Math.max(1, Math.ceil((error.retryAt - Date.now()) / 1000))));
      return res.status(error.statusCode).json({
        error: {
          code: error.code,
          message: error.message,
          upstreamStatus: error.upstreamStatus,
          retryAt: error.retryAt,
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

async function startServer() {
  const config = readConfig();
  const database = await initializeDatabase(config);
  const server = createApp({ config }).listen(config.port, config.host, () => {
    console.log(
      `Garmin Trainer disponibile su http://${config.host}:${config.port}`,
    );
  });
  server.on("error", async (error) => {
    console.error(
      `Avvio del server non riuscito (${error.code || "SERVER_ERROR"}).`,
    );
    process.exitCode = 1;
    await database.close();
  });
  const shutdown = () => server.close(() => database.close());
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  return server;
}

if (require.main === module) {
  startServer().catch((error) => {
    console.error(`Avvio non riuscito (${error.code || 'CONFIG_ERROR'}). Verifica MariaDB e la chiave di cifratura locale.`);
    process.exitCode = 1;
  });
}

module.exports = { createApp, startServer };
