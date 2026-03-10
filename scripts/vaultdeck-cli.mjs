#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { spawn, execSync } from "node:child_process";
import net from "node:net";

const VAULT = process.env.VAULTDECK_HOME || path.join(os.homedir(), ".vaultdeck");
const PATHS = {
  entries: path.join(VAULT, "entries"),
  files: path.join(VAULT, "files"),
  projects: path.join(VAULT, "projects"),
  meta: path.join(VAULT, "meta"),
  backups: path.join(VAULT, "backups"),
  envGenerated: path.join(VAULT, ".env.generated"),
  envExports: path.join(VAULT, ".env.exports.sh"),
  envMeta: path.join(VAULT, "meta", "env-generation.json"),
};

const SHELL_LINE = '[ -f "$HOME/.vaultdeck/.env.exports.sh" ] && source "$HOME/.vaultdeck/.env.exports.sh"';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.join(__dirname, "..");
const PACKAGE_JSON = path.join(PROJECT_ROOT, "package.json");
const UI_PID_FILE = path.join(VAULT, "meta", "ui.pid");
const UI_LOG_FILE = path.join(VAULT, "meta", "ui.log");
const UI_STATE_FILE = path.join(VAULT, "meta", "ui-state.json");
const UPDATE_STATE_FILE = path.join(VAULT, "meta", "update-check.json");

const VERSION = (() => {
  try {
    return JSON.parse(fs.readFileSync(PACKAGE_JSON, "utf8")).version || "0.0.0";
  } catch {
    return "0.0.0";
  }
})();

function ensure() {
  for (const dir of [PATHS.entries, PATHS.files, PATHS.projects, PATHS.meta, PATHS.backups]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(PATHS.envGenerated)) fs.writeFileSync(PATHS.envGenerated, "", "utf8");
  if (!fs.existsSync(PATHS.envExports)) fs.writeFileSync(PATHS.envExports, "", "utf8");
  if (!fs.existsSync(PATHS.envMeta)) fs.writeFileSync(PATHS.envMeta, "{}\n", "utf8");
}

function readJSON(file, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function sanitizeKey(input) {
  return (input || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[^A-Z_]+/, "");
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

function loadEntries() {
  ensure();
  const out = [];
  for (const file of fs.readdirSync(PATHS.entries)) {
    if (!file.endsWith(".json")) continue;
    const full = path.join(PATHS.entries, file);
    try {
      const d = JSON.parse(fs.readFileSync(full, "utf8"));
      if (!d?.id || !d?.name) continue;
      out.push(d);
    } catch {
      // skip invalid
    }
  }
  out.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  return out;
}

function regen() {
  const entries = loadEntries();
  const prevMeta = readJSON(PATHS.envMeta, {});
  const prevKeys = new Set(prevMeta.keys || []);

  const rows = [];
  const dupes = new Set();
  const invalid = new Set();
  const seen = new Set();

  for (const e of entries) {
    if (e.includeInEnv === false) continue;
    const value = String(e.value ?? "");
    if (!value.trim()) continue;
    const key = sanitizeKey(e.key || e.name || "");
    if (!key) {
      invalid.add(e.name || "unknown");
      continue;
    }
    if (seen.has(key)) dupes.add(key);
    seen.add(key);
    rows.push({ key, value });
  }

  rows.sort((a, b) => a.key.localeCompare(b.key));
  const keys = rows.map((r) => r.key);
  const removedKeys = [...prevKeys].filter((k) => !keys.includes(k)).sort((a, b) => a.localeCompare(b));

  const envContent = rows.map((r) => `${r.key}=${r.value.replace(/\n/g, "\\n")}`).join("\n") + (rows.length ? "\n" : "");
  const exportLines = [
    "# VaultDeck managed exports",
    ...removedKeys.map((k) => `unset ${k}`),
    ...rows.map((r) => `export ${r.key}=${shellQuote(r.value)}`),
  ];
  const exportContent = exportLines.join("\n") + "\n";

  const oldEnv = fs.existsSync(PATHS.envGenerated) ? fs.readFileSync(PATHS.envGenerated, "utf8") : "";
  const oldExp = fs.existsSync(PATHS.envExports) ? fs.readFileSync(PATHS.envExports, "utf8") : "";
  if (oldEnv || oldExp) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupDir = path.join(PATHS.backups, `env-${stamp}`);
    fs.mkdirSync(backupDir, { recursive: true });
    if (oldEnv) fs.writeFileSync(path.join(backupDir, ".env.generated"), oldEnv, "utf8");
    if (oldExp) fs.writeFileSync(path.join(backupDir, ".env.exports.sh"), oldExp, "utf8");
  }

  fs.writeFileSync(PATHS.envGenerated, envContent, "utf8");
  fs.writeFileSync(PATHS.envExports, exportContent, "utf8");

  const checksum = crypto.createHash("sha256").update(`${envContent}\n---\n${exportContent}`).digest("hex");
  const meta = {
    envCount: rows.length,
    duplicateKeys: [...dupes].sort(),
    invalidNames: [...invalid].sort(),
    generatedAt: new Date().toISOString(),
    checksum,
    envPath: PATHS.envGenerated,
    exportPath: PATHS.envExports,
    keys,
    removedKeys,
  };
  fs.writeFileSync(PATHS.envMeta, `${JSON.stringify(meta, null, 2)}\n`, "utf8");
  return meta;
}

function status() {
  ensure();
  const entries = loadEntries();
  const envCompatible = entries.filter((e) => e.includeInEnv !== false).length;
  const meta = readJSON(PATHS.envMeta, {});
  const update = readUpdateState();
  console.log(`Vault: ${VAULT}`);
  console.log(`Env-compatible entries: ${envCompatible}`);
  console.log(`Generated file: ${PATHS.envGenerated} (${fs.existsSync(PATHS.envGenerated) ? "yes" : "no"})`);
  console.log(`Exports file:   ${PATHS.envExports} (${fs.existsSync(PATHS.envExports) ? "yes" : "no"})`);
  console.log(`Last generated: ${meta.generatedAt || "never"}`);
  if (meta.duplicateKeys?.length) console.log(`Duplicate keys: ${meta.duplicateKeys.join(", ")}`);
  if (meta.invalidNames?.length) console.log(`Invalid names: ${meta.invalidNames.join(", ")}`);
  if (update.available) {
    console.log(`Update available (${update.branch || "origin"}). Run: vaultdeck update`);
  }
}

function apply(regenFirst = false) {
  if (regenFirst) regen();
  ensure();
  process.stdout.write(fs.readFileSync(PATHS.envExports, "utf8"));
}

function permOctal(filePath) {
  try {
    return (fs.statSync(filePath).mode & 0o777).toString(8);
  } catch {
    return null;
  }
}

function isPidRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readUiPid() {
  try {
    return Number(fs.readFileSync(UI_PID_FILE, "utf8").trim());
  } catch {
    return null;
  }
}

function readUiState() {
  return readJSON(UI_STATE_FILE, {});
}

function writeUiState(state) {
  fs.writeFileSync(UI_STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

function readUpdateState() {
  return readJSON(UPDATE_STATE_FILE, {});
}

function writeUpdateState(state) {
  fs.writeFileSync(UPDATE_STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(port, "127.0.0.1");
  });
}

async function findFreePort(startPort = 3000, maxPort = 3100) {
  for (let p = startPort; p <= maxPort; p += 1) {
    if (await isPortFree(p)) return p;
  }
  throw new Error(`No free port found between ${startPort}-${maxPort}`);
}

function uiStatus() {
  ensure();
  const pid = readUiPid();
  const state = readUiState();
  if (!pid) {
    console.log("UI status: stopped (no pid file)");
    return;
  }
  if (isPidRunning(pid)) {
    console.log(`UI status: running (pid ${pid})`);
    if (state.port) console.log(`URL: http://localhost:${state.port}`);
    console.log(`Log: ${UI_LOG_FILE}`);
  } else {
    console.log(`UI status: stale pid file (${pid}), process not running`);
  }
}

async function startUi() {
  ensure();
  const pid = readUiPid();
  const state = readUiState();
  if (pid && isPidRunning(pid)) {
    console.log(`UI already running (pid ${pid})`);
    if (state.port) console.log(`URL: http://localhost:${state.port}`);
    return;
  }

  const preferred = Number(process.env.VAULTDECK_PORT || state.port || 3000);
  const port = await findFreePort(preferred, preferred + 30);

  const nodeModulesPath = path.join(PROJECT_ROOT, "node_modules");
  if (!fs.existsSync(nodeModulesPath)) {
    console.log("Dependencies missing. Installing once before start...");
    execSync("npm install", { cwd: PROJECT_ROOT, stdio: "inherit" });
  }

  const buildIdPath = path.join(PROJECT_ROOT, ".next", "BUILD_ID");
  if (!fs.existsSync(buildIdPath)) {
    console.log("No production build found. Building once before start...");
    execSync("npm run build", { cwd: PROJECT_ROOT, stdio: "inherit" });
  }

  const logFd = fs.openSync(UI_LOG_FILE, "a");
  const child = spawn("npm", ["run", "start", "--", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: PROJECT_ROOT,
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: { ...process.env },
  });

  child.unref();
  fs.writeFileSync(UI_PID_FILE, `${child.pid}\n`, { encoding: "utf8", mode: 0o600 });
  writeUiState({ pid: child.pid, port, startedAt: new Date().toISOString() });
  console.log(`Started UI (pid ${child.pid})`);
  console.log(`URL: http://localhost:${port}`);
  console.log(`Log: ${UI_LOG_FILE}`);
}

function stopUi() {
  ensure();
  const pid = readUiPid();
  if (!pid) {
    console.log("UI already stopped");
    return;
  }
  if (!isPidRunning(pid)) {
    fs.rmSync(UI_PID_FILE, { force: true });
    fs.rmSync(UI_STATE_FILE, { force: true });
    console.log("Removed stale UI pid file");
    return;
  }

  try {
    process.kill(pid, "SIGTERM");
    fs.rmSync(UI_PID_FILE, { force: true });
    fs.rmSync(UI_STATE_FILE, { force: true });
    console.log(`Stopped UI (pid ${pid})`);
  } catch {
    console.log(`Could not stop UI process ${pid}`);
    process.exitCode = 1;
  }
}

function checkForUpdate(quiet = false) {
  ensure();
  if (!fs.existsSync(path.join(PROJECT_ROOT, ".git"))) {
    if (!quiet) console.log("Update check unavailable: not a git checkout.");
    return { available: false, reason: "not-git" };
  }

  try {
    const remoteHead = execSync("git symbolic-ref --quiet --short refs/remotes/origin/HEAD", {
      cwd: PROJECT_ROOT,
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
    }).trim(); // origin/main

    const branch = remoteHead.replace(/^origin\//, "") || "main";
    execSync(`git fetch origin ${branch} --quiet`, { cwd: PROJECT_ROOT, stdio: "ignore" });

    const local = execSync("git rev-parse HEAD", {
      cwd: PROJECT_ROOT,
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
    }).trim();
    const remote = execSync(`git rev-parse origin/${branch}`, {
      cwd: PROJECT_ROOT,
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
    }).trim();

    const available = local !== remote;
    const result = { available, branch, local, remote, checkedAt: new Date().toISOString() };
    writeUpdateState(result);

    if (!quiet) {
      if (available) {
        console.log(`Update available on ${branch}.`);
        console.log("Run: vaultdeck update");
      } else {
        console.log("VaultDeck is up to date.");
      }
    }

    return result;
  } catch {
    const result = { available: false, reason: "check-failed", checkedAt: new Date().toISOString() };
    writeUpdateState(result);
    if (!quiet) console.log("Update check failed (network or git remote issue).");
    return result;
  }
}

function updateVaultDeck() {
  ensure();

  if (!fs.existsSync(path.join(PROJECT_ROOT, ".git"))) {
    console.error(`Not a git repo: ${PROJECT_ROOT}`);
    process.exit(1);
  }

  console.log(`Updating VaultDeck in: ${PROJECT_ROOT}`);

  try {
    execSync("git fetch --all --prune", { cwd: PROJECT_ROOT, stdio: "inherit" });
    execSync("git pull --ff-only", { cwd: PROJECT_ROOT, stdio: "inherit" });
  } catch {
    console.error("Git update failed. If you have local changes, commit/stash first.");
    process.exit(1);
  }

  console.log("Installing dependencies...");
  execSync("npm install", { cwd: PROJECT_ROOT, stdio: "inherit" });

  console.log("Building project...");
  execSync("npm run build", { cwd: PROJECT_ROOT, stdio: "inherit" });

  checkForUpdate(true);
  console.log("Update complete.");
}

function doctor() {
  ensure();
  const checks = [];

  const pVault = permOctal(VAULT);
  const pEnv = permOctal(PATHS.envGenerated);
  const pExports = permOctal(PATHS.envExports);

  checks.push({ name: "vault dir permissions", ok: pVault === "700", detail: `expected 700, got ${pVault ?? "missing"}` });
  checks.push({ name: ".env.generated permissions", ok: pEnv === "600", detail: `expected 600, got ${pEnv ?? "missing"}` });
  checks.push({ name: ".env.exports.sh permissions", ok: pExports === "600", detail: `expected 600, got ${pExports ?? "missing"}` });

  const exportsBody = fs.readFileSync(PATHS.envExports, "utf8");
  checks.push({
    name: "exports file has managed header",
    ok: exportsBody.includes("# VaultDeck managed exports"),
    detail: "missing managed header",
  });

  const envMeta = readJSON(PATHS.envMeta, {});
  checks.push({
    name: "env generation metadata exists",
    ok: !!envMeta && typeof envMeta === "object",
    detail: "missing or unreadable env-generation.json",
  });

  let okCount = 0;
  for (const c of checks) {
    if (c.ok) {
      okCount += 1;
      console.log(`✅ ${c.name}`);
    } else {
      console.log(`⚠️  ${c.name} (${c.detail})`);
    }
  }

  const failed = checks.length - okCount;
  console.log(`\nDoctor summary: ${okCount}/${checks.length} checks passed`);
  if (failed > 0) process.exitCode = 1;
}

async function main() {
  const [, , cmd, ...args] = process.argv;
  if (!cmd || ["-h", "--help"].includes(cmd)) {
    console.log(`vaultdeck v${VERSION}

vaultdeck <command>

Commands:
  status       Show vault/env status
  regen        Regenerate env files
  apply        Print exports/unsets for eval
  start        Start VaultDeck web UI in background
  stop         Stop VaultDeck web UI
  ui-status    Show VaultDeck web UI process status
  check-update Check if a newer commit exists on origin
  update       Pull latest repo + install + build
  doctor       Run local safety checks
  shell-line   Print shell integration line
  version      Print CLI version

Examples:
  vaultdeck status
  vaultdeck regen
  eval "$(vaultdeck apply --regen)"
  vaultdeck version`);
    process.exit(0);
  }

  if (["-v", "--version", "version"].includes(cmd)) {
    console.log(`vaultdeck v${VERSION}`);
    process.exit(0);
  }

  if (cmd === "status") return void status();
  if (cmd === "regen") {
    const m = regen();
    console.log(`Regenerated ${m.envCount} vars`);
    return;
  }
  if (cmd === "shell-line") return void console.log(SHELL_LINE);
  if (cmd === "apply") return void apply(args.includes("--regen"));
  if (cmd === "start") return void (await startUi());
  if (cmd === "stop") return void stopUi();
  if (cmd === "ui-status") return void uiStatus();
  if (cmd === "check-update") return void checkForUpdate(false);
  if (cmd === "update") return void updateVaultDeck();
  if (cmd === "doctor") return void doctor();

  console.error(`Unknown command: ${cmd}`);
  process.exit(1);
}

main().catch((err) => {
  console.error(err?.message || String(err));
  process.exit(1);
});
