import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const action = process.argv[2] || "deploy";
const actions = ["deploy", "status", "logs", "backup", "verify"];
if (action === "--help") {
  console.log(
    `Uso: npm run deploy:vps -- [${actions.join("|")}]\nConfigurazione: deploy/vps.json. Nessun secret locale viene trasferito.\nSSH richiede la password se necessaria e riusa la connessione per tutta l'operazione.`,
  );
  process.exit(0);
}
if (!actions.includes(action) || process.argv.length > 3)
  throw new Error("Azione non valida. Usa --help.");
const config = JSON.parse(
  readFileSync(new URL("../deploy/vps.json", import.meta.url), "utf8"),
);
if (!/^[a-z_][a-z0-9_-]*@[a-zA-Z0-9.-]+$/.test(config.host))
  throw new Error("Host SSH non valido.");
if (
  !/^\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+$/.test(config.directory) ||
  config.directory.split("/").length < 4
)
  throw new Error("Directory remota non valida.");
if (
  !/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(config.domain) ||
  !config.domain.includes(".")
)
  throw new Error("Dominio non valido.");
const identity = config.identityFile.startsWith("~/")
  ? join(homedir(), config.identityFile.slice(2))
  : config.identityFile;
const options = [
  "-i",
  identity,
  "-o",
  "BatchMode=no",
  "-o",
  "ControlMaster=auto",
  "-o",
  "ControlPersist=60",
  "-o",
  "ConnectTimeout=15",
  "-o",
  "ServerAliveInterval=15",
  "-o",
  "ServerAliveCountMax=4",
];
const quote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`;
function run(command, args, extra = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    ...extra,
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(
      `${command}: operazione non riuscita (${result.status ?? result.signal}).`,
    );
}
function ssh(command) {
  run("ssh", [...options, config.host, command]);
}

let temporary;
try {
  // Keep the authenticated connection in a private socket shared by ssh and scp.
  temporary = mkdtempSync(join(tmpdir(), "garmintrainer-deploy-"));
  options.push("-o", `ControlPath=${join(temporary, "ssh")}`);
  if (action === "deploy") {
    const release = `${new Date()
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d+Z$/, "Z")}-${process.pid}`;
    const incoming = `${config.directory}/incoming/${release}.tgz`;
    const destination = `${config.directory}/releases/${release}`;
    const archive = join(temporary, "release.tgz");
    // Explicit allowlist: never include .git, data/, unlock keys or host dependencies.
    run("tar", [
      "-czf",
      archive,
      "--no-xattrs",
      "Dockerfile",
      ".dockerignore",
      "package.json",
      "package-lock.json",
      "app.js",
      "libs",
      "routes",
      "controllers",
      "helpers",
      "langs",
      "db/migrations/mariadb",
      "frontend",
      "vite.config.mjs",
      "deploy",
    ]);
    ssh(
      `umask 077; mkdir -p ${quote(`${config.directory}/incoming`)} ${quote(destination)}`,
    );
    run("scp", [...options, archive, `${config.host}:${incoming}`]);
    ssh(
      `set -eu; umask 077; tar -xzf ${quote(incoming)} -C ${quote(destination)}; rm -- ${quote(incoming)}; python3 ${quote(`${destination}/deploy/remote.py`)} deploy ${quote(config.directory)} ${quote(config.domain)} ${quote(release)}`,
    );
  } else {
    ssh(
      `python3 ${quote(`${config.directory}/current/deploy/remote.py`)} ${quote(action)} ${quote(config.directory)} ${quote(config.domain)}`,
    );
  }
} catch (error) {
  console.error(error.message);
  console.error(
    "Controlla lo stato con npm run deploy:vps -- status e i log con npm run deploy:vps -- logs.",
  );
  process.exitCode = 1;
} finally {
  if (temporary) {
    // Closing a missing/already closed master must not hide the original error.
    spawnSync("ssh", [...options, "-O", "exit", config.host], {
      cwd: root,
      stdio: "ignore",
    });
    rmSync(temporary, { recursive: true, force: true });
  }
}
