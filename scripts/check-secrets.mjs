import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { SECRET_FILES, isEncrypted } from "./secret-files.mjs";

function git(args, optional = false) {
  const result = spawnSync("git", args, { maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0) {
    if (optional) return null;
    throw new Error(`Impossibile verificare Git (${args[0]}).`);
  }
  return result.stdout;
}
const text = (args) => git(args).toString("utf8");
const split = (value) => value.toString("utf8").split("\0").filter(Boolean);
const isUnlockKey = (filename) =>
  filename.startsWith(".local-keys/") ||
  /(^|\/)(?:.*\.)?git-crypt\.key$/.test(filename);

function checkSnapshot(revision) {
  const staged = revision === null;
  const label = staged ? "indice" : revision.slice(0, 12);
  const files = staged
    ? split(git(["ls-files", "-z"]))
    : split(git(["ls-tree", "-r", "-z", "--name-only", revision]));
  for (const filename of files)
    if (isUnlockKey(filename))
      throw new Error(
        `Chiave di sblocco esclusa da Git: ${filename} (${label}).`,
      );
  const protectedFiles = SECRET_FILES.filter((filename) =>
    files.includes(filename),
  );
  // History before git-crypt was configured contains no installation secrets.
  if (!staged && !protectedFiles.length) return;
  for (const filename of SECRET_FILES) {
    if (!files.includes(filename))
      throw new Error(`Secret mancante: ${filename} (${label}).`);
    const blob = git([
      "cat-file",
      "blob",
      staged ? `:${filename}` : `${revision}:${filename}`,
    ]);
    if (!isEncrypted(blob))
      throw new Error(
        `Secret NON cifrato: ${filename} (${label}). Il commit/push è bloccato.`,
      );
  }
  if (staged) {
    const attributes = split(
      git(["check-attr", "--cached", "-z", "filter", "--", ...SECRET_FILES]),
    );
    for (let i = 0; i < attributes.length; i += 3) {
      if (attributes[i + 2] !== "git-crypt")
        throw new Error(`Filtro git-crypt mancante per ${attributes[i]}.`);
    }
  }
}

function checkHistory(revisions) {
  const seen = new Set();
  for (const revision of revisions) {
    for (const commit of text(["rev-list", revision])
      .trim()
      .split("\n")
      .filter(Boolean)) {
      if (!seen.has(commit)) {
        checkSnapshot(commit);
        seen.add(commit);
      }
    }
  }
  return seen.size;
}

try {
  const mode = process.argv[2] || "--staged";
  if (mode === "--staged") {
    checkSnapshot(null);
    console.log(
      "Indice verificato: tre secret cifrati, chiave di sblocco esclusa.",
    );
  } else if (mode === "--history") {
    const count = checkHistory([process.argv[3] || "HEAD"]);
    console.log(`Cifratura verificata su ${count} commit.`);
  } else if (mode === "--pre-push") {
    const ranges = [];
    for (const line of readFileSync(0, "utf8").split("\n").filter(Boolean)) {
      const [, local, , remote] = line.trim().split(/\s+/);
      if (
        !/^[a-f0-9]{40,64}$/.test(local || "") ||
        !/^[a-f0-9]{40,64}$/.test(remote || "")
      )
        throw new Error("Riferimenti Git non validi.");
      if (/^0+$/.test(local)) continue;
      const hasRemote =
        !/^0+$/.test(remote) &&
        git(["cat-file", "-e", `${remote}^{commit}`], true) !== null;
      ranges.push(hasRemote ? `${remote}..${local}` : local);
    }
    const count = checkHistory(ranges);
    console.log(`Push verificato: ${count} nuovi commit controllati.`);
  } else throw new Error("Usare --staged, --history oppure --pre-push.");
} catch (error) {
  // Report only paths and commit IDs. Never print blob contents or secret values.
  console.error(error.message);
  process.exitCode = 1;
}
