#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { spawn, execSync } from "node:child_process";
import net from "node:net";

const VAULT = process.env.VAULTDECK_HOME || path.join(os.homedir(), ".vaultdeck");
const ENV_D_DIR = path.join(os.homedir(), ".config", "environment.d");
const GLOBAL_ENV_PATH = path.join(ENV_D_DIR, "90-vaultdeck.conf");

const PATHS = {
  entries: path.join(VAULT, "entries"),
  files: path.join(VAULT, "files"),
  projects: path.join(VAULT, "projects"),
  meta: path.join(VAULT, "meta"),
  backups: path.join(VAULT, "backups"),
  envGenerated: path.join(VAULT, ".env.generated"),
  envExports: path.join(VAULT, ".env.exports.sh"),
  envMeta: path.join(VAULT, "meta", "env-generation.json"),
  settings: path.join(VAULT, "meta", "settings.json"),
  globalEnv: GLOBAL_ENV_PATH,
};

const SHELL_LINE = '[ -f "$HOME/.vaultdeck/.env.exports.sh" ] && source "$HOME/.vaultdeck/.env.exports.sh"';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.join(__dirname, "..");
const PACKAGE_JSON = path.join(PROJECT_ROOT, "package.json");
const PROJECT_SETTINGS_FILE = path.join(PROJECT_ROOT, "vaultdeck.settings.json");
const UI_PID_FILE = path.join(VAULT, "meta", "ui.pid");
const UI_LOG_FILE = path.join(VAULT, "meta", "ui.log");
const UI_STATE_FILE = path.join(VAULT, "meta", "ui-state.json");
const UI_START_LOCK_FILE = path.join(VAULT, "meta", "ui-start.lock");
const UPDATE_STATE_FILE = path.join(VAULT, "meta", "update-check.json");
const DEFAULT_UI_PORT = 3000;
const DEFAULT_UI_HOST = "127.0.0.1";

const VERSION = (() => {
  try {
    return JSON.parse(fs.readFileSync(PACKAGE_JSON, "utf8")).version || "0.0.0";
  } catch {
    return "0.0.0";
  }
})();

function ensure() {
  for (const dir of [PATHS.entries, PATHS.files, PATHS.projects, PATHS.meta, PATHS.backups]) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    try { fs.chmodSync(dir, 0o700); } catch {}
  }
  fs.mkdirSync(ENV_D_DIR, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(ENV_D_DIR, 0o700); } catch {}

  if (!fs.existsSync(PATHS.envGenerated)) fs.writeFileSync(PATHS.envGenerated, "", { encoding: "utf8", mode: 0o600 });
  if (!fs.existsSync(PATHS.envExports)) fs.writeFileSync(PATHS.envExports, "", { encoding: "utf8", mode: 0o600 });
  if (!fs.existsSync(PATHS.envMeta)) fs.writeFileSync(PATHS.envMeta, "{}\n", { encoding: "utf8", mode: 0o600 });
  if (!fs.existsSync(PATHS.settings)) fs.writeFileSync(PATHS.settings, "{}\n", { encoding: "utf8", mode: 0o600 });
}

function readJSON(file, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function readProjectSettings() {
  return readJSON(PROJECT_SETTINGS_FILE, {});
}

function writeJSON(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

function getSettings() {
  const s = readJSON(PATHS.settings, {});
  return { globalEnv: { enabled: s?.globalEnv?.enabled === true } };
}

function setGlobalEnabled(enabled) {
  const s = readJSON(PATHS.settings, {});
  s.globalEnv = { ...(s.globalEnv || {}), enabled };
  writeJSON(PATHS.settings, s);
}

function sanitizeKey(input) {
  return (input || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[^A-Z_]+/, "");
}

function posixSafeKey(key) {
  return /^[A-Z_][A-Z0-9_]*$/.test(key);
}

function envdQuote(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
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

function backupFileIfExists(filePath, label = "global") {
  if (!fs.existsSync(filePath)) return;
  const old = fs.readFileSync(filePath, "utf8");
  if (!old) return;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = path.join(PATHS.backups, `${label}-${stamp}`);
  fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(backupDir, path.basename(filePath)), old, { encoding: "utf8", mode: 0o600 });
}

function writeGlobalEnvFile(rows) {
  const settings = getSettings();
  if (!settings.globalEnv.enabled) return { enabled: false, path: PATHS.globalEnv };

  const filtered = rows.filter((r) => posixSafeKey(r.key));
  const body = ["# VaultDeck managed global env (systemd user environment.d)"]
    .concat(filtered.map((r) => `${r.key}=${envdQuote(r.value)}`))
    .join("\n") + "\n";

  backupFileIfExists(PATHS.globalEnv, "global-env");
  fs.writeFileSync(PATHS.globalEnv, body, { encoding: "utf8", mode: 0o600 });
  try { fs.chmodSync(PATHS.globalEnv, 0o600); } catch {}

  try { execSync("systemctl --user daemon-reload", { stdio: "ignore" }); } catch {}
  return { enabled: true, path: PATHS.globalEnv, count: filtered.length };
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
  const globalResult = writeGlobalEnvFile(rows);
  meta.globalEnv = {
    enabled: globalResult.enabled,
    path: globalResult.path,
    count: globalResult.count || 0,
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
  const settings = getSettings();
  console.log(`Last generated: ${meta.generatedAt || "never"}`);
  console.log(`Global env mode: ${settings.globalEnv.enabled ? "enabled" : "disabled"}`);
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
    const pid = Number(fs.readFileSync(UI_PID_FILE, "utf8").trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function readUiState() {
  return readJSON(UI_STATE_FILE, {});
}

function getTrackedUiPid() {
  const pidFromFile = readUiPid();
  if (pidFromFile) return pidFromFile;
  const state = readUiState();
  const pidFromState = Number(state?.pid);
  return Number.isInteger(pidFromState) && pidFromState > 0 ? pidFromState : null;
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

function isPortFree(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(port, host);
  });
}

function cleanupUiTrackingFiles() {
  fs.rmSync(UI_PID_FILE, { force: true });
  fs.rmSync(UI_STATE_FILE, { force: true });
}

function resolveUiPort(state = {}) {
  const projectSettings = readProjectSettings();
  const candidate = Number(process.env.VAULTDECK_PORT || projectSettings?.ui?.port || state.port || DEFAULT_UI_PORT);
  if (!Number.isInteger(candidate) || candidate < 1 || candidate > 65535) return DEFAULT_UI_PORT;
  return candidate;
}

function resolveUiHost(state = {}) {
  const projectSettings = readProjectSettings();
  const candidate = String(process.env.VAULTDECK_HOST || projectSettings?.ui?.host || state.host || DEFAULT_UI_HOST).trim();
  return candidate || DEFAULT_UI_HOST;
}

function uiUrl(host, port) {
  const displayHost = host === "0.0.0.0" ? "localhost" : host;
  return `http://${displayHost}:${port}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForPidExit(pid, timeoutMs = 5000, pollMs = 100) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isPidRunning(pid)) return true;
    await sleep(pollMs);
  }
  return !isPidRunning(pid);
}

function tryAcquireUiStartLock() {
  try {
    const fd = fs.openSync(UI_START_LOCK_FILE, "wx", 0o600);
    fs.writeFileSync(fd, `${process.pid}\n`, { encoding: "utf8" });
    return fd;
  } catch {
    try {
      const ownerPid = Number(fs.readFileSync(UI_START_LOCK_FILE, "utf8").trim());
      if (!Number.isInteger(ownerPid) || ownerPid < 1 || !isPidRunning(ownerPid)) {
        fs.rmSync(UI_START_LOCK_FILE, { force: true });
        const fd = fs.openSync(UI_START_LOCK_FILE, "wx", 0o600);
        fs.writeFileSync(fd, `${process.pid}\n`, { encoding: "utf8" });
        return fd;
      }
    } catch {}
    return null;
  }
}

function releaseUiStartLock(fd) {
  try { fs.closeSync(fd); } catch {}
  fs.rmSync(UI_START_LOCK_FILE, { force: true });
}

function uiStatus() {
  ensure();
  const pid = getTrackedUiPid();
  const state = readUiState();
  if (!pid) {
    console.log("UI status: stopped (no pid file)");
    return;
  }
  if (isPidRunning(pid)) {
    console.log(`UI status: running (pid ${pid})`);
    const host = state.host || resolveUiHost(state);
    if (state.port) console.log(`URL: ${uiUrl(host, state.port)}`);
    console.log(`Log: ${UI_LOG_FILE}`);
  } else {
    console.log(`UI status: stale pid file (${pid}), process not running`);
  }
}

async function startUi() {
  ensure();
  const lockFd = tryAcquireUiStartLock();
  if (lockFd === null) {
    console.log("UI start is already in progress. Try again in a moment.");
    process.exitCode = 1;
    return;
  }

  try {
    const pid = getTrackedUiPid();
    const state = readUiState();
    if (pid && isPidRunning(pid)) {
      console.log(`UI already running (pid ${pid})`);
      const host = state.host || resolveUiHost(state);
      if (state.port) console.log(`URL: ${uiUrl(host, state.port)}`);
      return;
    }
    if (pid && !isPidRunning(pid)) cleanupUiTrackingFiles();

    const port = resolveUiPort(state);
    const host = resolveUiHost(state);
    if (!(await isPortFree(port, host))) {
      console.log(`UI start failed: port ${port} is already in use.`);
      console.log("This usually means another VaultDeck UI instance is already running.");
      console.log(`Run \`vaultdeck stop\` first, set VAULTDECK_PORT, or edit ${PROJECT_SETTINGS_FILE}.`);
      process.exitCode = 1;
      return;
    }

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
    const child = spawn("npm", ["run", "start", "--", "--hostname", host, "--port", String(port)], {
      cwd: PROJECT_ROOT,
      detached: true,
      stdio: ["ignore", logFd, logFd],
      env: { ...process.env },
    });

    child.unref();
    fs.writeFileSync(UI_PID_FILE, `${child.pid}\n`, { encoding: "utf8", mode: 0o600 });
    writeUiState({ pid: child.pid, host, port, startedAt: new Date().toISOString() });
    console.log(`Started UI (pid ${child.pid})`);
    console.log(`URL: ${uiUrl(host, port)}`);
    console.log(`Log: ${UI_LOG_FILE}`);
  } finally {
    releaseUiStartLock(lockFd);
  }
}

async function stopUi() {
  ensure();
  const pid = getTrackedUiPid();
  if (!pid) {
    console.log("UI already stopped");
    return;
  }
  if (!isPidRunning(pid)) {
    cleanupUiTrackingFiles();
    console.log("Removed stale UI pid file");
    return;
  }

  try {
    let signaled = false;
    try {
      process.kill(-pid, "SIGTERM");
      signaled = true;
    } catch {}
    if (!signaled) process.kill(pid, "SIGTERM");

    let stopped = await waitForPidExit(pid, 5000);
    if (!stopped) {
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        process.kill(pid, "SIGKILL");
      }
      stopped = await waitForPidExit(pid, 1500);
    }

    if (!stopped) {
      console.log(`Could not stop UI process ${pid}`);
      process.exitCode = 1;
      return;
    }

    cleanupUiTrackingFiles();
    console.log(`Stopped UI (pid ${pid})`);
  } catch {
    console.log(`Could not stop UI process ${pid}`);
    process.exitCode = 1;
  }
}

async function restartUi() {
  await stopUi();
  if (process.exitCode) return;
  await startUi();
}

function systemdUserSeesKeys(keys = []) {
  try {
    const out = execSync("systemctl --user show-environment", {
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
    });
    const present = new Set(out.split("\n").map((line) => line.split("=")[0]).filter(Boolean));
    return keys.every((k) => present.has(k));
  } catch {
    return null;
  }
}

function globalStatus() {
  ensure();
  const s = getSettings();
  const meta = readJSON(PATHS.envMeta, {});
  const keys = meta?.keys || [];
  const managerSees = systemdUserSeesKeys(keys.slice(0, 30));

  console.log(`Global env: ${s.globalEnv.enabled ? "enabled" : "disabled"}`);
  console.log(`Global file: ${PATHS.globalEnv}`);
  console.log(`Exists: ${fs.existsSync(PATHS.globalEnv) ? "yes" : "no"}`);
  console.log(`Last generation: ${meta.generatedAt || "never"}`);
  console.log(`Systemd user manager sees keys: ${managerSees === null ? "unknown" : managerSees ? "yes" : "no"}`);

  if (s.globalEnv.enabled && managerSees === false) {
    console.log("Hint: run `vaultdeck regen` then restart user services (or relogin).");
  }
}

function globalEnable() {
  ensure();
  setGlobalEnabled(true);
  const meta = regen();
  console.log("Global environment mode enabled.");
  console.log(`Generated: ${PATHS.globalEnv}`);
  console.log(`Regenerated ${meta.envCount} vars. Restart user services if needed.`);
}

function globalDisable() {
  ensure();
  setGlobalEnabled(false);
  if (fs.existsSync(PATHS.globalEnv)) {
    backupFileIfExists(PATHS.globalEnv, "global-env-disabled");
    fs.rmSync(PATHS.globalEnv, { force: true });
  }
  try { execSync("systemctl --user daemon-reload", { stdio: "ignore" }); } catch {}
  console.log("Global environment mode disabled.");
  console.log("Restart user services (or relogin) to clear inherited vars.");
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

  const settings = getSettings();
  if (settings.globalEnv.enabled) {
    checks.push({
      name: "global env file exists when enabled",
      ok: fs.existsSync(PATHS.globalEnv),
      detail: `missing ${PATHS.globalEnv}`,
    });
    checks.push({
      name: "global env file permissions",
      ok: permOctal(PATHS.globalEnv) === "600",
      detail: `expected 600, got ${permOctal(PATHS.globalEnv) ?? "missing"}`,
    });
    const managerSees = systemdUserSeesKeys((envMeta?.keys || []).slice(0, 20));
    checks.push({
      name: "systemd user manager sees sample keys",
      ok: managerSees !== false,
      detail: "run `vaultdeck regen` and restart user services/relogin",
    });
  }

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
  restart      Restart VaultDeck web UI
  ui-status    Show VaultDeck web UI process status
  check-update Check if a newer commit exists on origin
  global enable|disable|status  Manage systemd user global env mode
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
  if (cmd === "stop") return void (await stopUi());
  if (cmd === "restart") return void (await restartUi());
  if (cmd === "ui-status") return void uiStatus();
  if (cmd === "check-update") return void checkForUpdate(false);
  if (cmd === "global") {
    const sub = args[0] || "status";
    if (sub === "enable") return void globalEnable();
    if (sub === "disable") return void globalDisable();
    if (sub === "status") return void globalStatus();
    console.error("Usage: vaultdeck global <enable|disable|status>");
    process.exit(1);
  }
  if (cmd === "update") return void updateVaultDeck();
  if (cmd === "doctor") return void doctor();

  console.error(`Unknown command: ${cmd}`);
  process.exit(1);
}

main().catch((err) => {
  console.error(err?.message || String(err));
  process.exit(1);
});
