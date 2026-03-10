#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

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
const PACKAGE_JSON = path.join(__dirname, "..", "package.json");
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
  console.log(`Vault: ${VAULT}`);
  console.log(`Env-compatible entries: ${envCompatible}`);
  console.log(`Generated file: ${PATHS.envGenerated} (${fs.existsSync(PATHS.envGenerated) ? "yes" : "no"})`);
  console.log(`Exports file:   ${PATHS.envExports} (${fs.existsSync(PATHS.envExports) ? "yes" : "no"})`);
  console.log(`Last generated: ${meta.generatedAt || "never"}`);
  if (meta.duplicateKeys?.length) console.log(`Duplicate keys: ${meta.duplicateKeys.join(", ")}`);
  if (meta.invalidNames?.length) console.log(`Invalid names: ${meta.invalidNames.join(", ")}`);
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

function main() {
  const [, , cmd, ...args] = process.argv;
  if (!cmd || ["-h", "--help"].includes(cmd)) {
    console.log(`vaultdeck v${VERSION}

vaultdeck <command>

Commands:
  status       Show vault/env status
  regen        Regenerate env files
  apply        Print exports/unsets for eval
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
  if (cmd === "doctor") return void doctor();

  console.error(`Unknown command: ${cmd}`);
  process.exit(1);
}

main();
