import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isEncrypted } from "./secret-files.mjs";

const cwd = fileURLToPath(new URL("../", import.meta.url));
const action = process.argv[2] || "up";
if (!["up", "down", "logs", "db", "dev", "test", "test-gymfit"].includes(action))
  throw new Error("Azione Docker non valida.");

if (["up", "db", "dev", "test", "test-gymfit"].includes(action)) {
  const files = [
    ["data/secrets/db_password", () => randomBytes(32).toString("hex")],
    ["data/secrets/db_root_password", () => randomBytes(32).toString("hex")],
    ["data/encryption.key", () => randomBytes(32)],
  ];
  const present = files.map(([filename]) => existsSync(`${cwd}${filename}`));
  if (
    files.some(
      ([filename], index) =>
        present[index] && isEncrypted(readFileSync(`${cwd}${filename}`)),
    )
  ) {
    throw new Error(
      "Secret ancora cifrati: esegui git-crypt unlock /percorso/garmintrainer.git-crypt.key prima di avviare Docker.",
    );
  }
  if (present.some(Boolean) && !present.every(Boolean))
    throw new Error(
      "Segreti incompleti: ripristina i file mancanti dal backup. Le credenziali esistenti non vengono sostituite.",
    );
  if (!present.some(Boolean)) {
    mkdirSync(`${cwd}data/secrets`, { recursive: true, mode: 0o700 });
    for (const [filename, value] of files)
      writeFileSync(`${cwd}${filename}`, value(), { mode: 0o600, flag: "wx" });
  }
  chmodSync(`${cwd}data/secrets`, 0o700);
  for (const [filename] of files) chmodSync(`${cwd}${filename}`, 0o600);
}

const dockerEnvironment = {
  ...process.env,
  COMPOSE_DISABLE_ENV_FILE: "true",
  LOCAL_UID: String(process.getuid?.() || 1000),
  LOCAL_GID: String(process.getgid?.() || 1000),
};
delete dockerEnvironment.COMPOSE_ENV_FILES;
const compose = ["compose", "-f", "compose.yaml"];
function run(args) {
  const result = spawnSync("docker", [...compose, ...args], {
    cwd,
    stdio: "inherit",
    env: dockerEnvironment,
  });
  if (result.error)
    console.error("Docker non disponibile. Avvia il servizio Docker locale.");
  return result.status ?? 1;
}

if (action === "test" || action === "test-gymfit") {
  const started = run(["up", "-d", "--wait", "db"]);
  process.exitCode =
    started || run(["--profile", "test", "run", "--build", "--rm", "test", ...(action === "test-gymfit" ? ["node", "--test", "test/gymfit.integration.js"] : [])]);
} else if (action === "dev") {
  process.exitCode = run([
    "-f",
    "compose.dev.yaml",
    "up",
    "--build",
    "--watch",
    "app",
  ]);
} else {
  const args =
    action === "up"
      ? ["up", "--build", "-d", "--wait"]
      : action === "db"
        ? ["up", "-d", "--wait", "db"]
        : action === "logs"
          ? ["logs", "--tail", "100", "-f"]
          : ["down"];
  process.exitCode = run(args);
}
