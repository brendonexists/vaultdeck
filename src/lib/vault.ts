import { promises as fs } from "fs";
import path from "path";
import os from "os";
import { randomUUID, createHash } from "crypto";
import { VAULT_TYPES, VaultEntry, VaultFile, VaultProject } from "@/lib/models";

export type ActivityItem = {
  id: string;
  action: string;
  target: string;
  at: string;
};

export type EnvGenerationResult = {
  envCount: number;
  duplicateKeys: string[];
  invalidNames: string[];
  generatedAt: string;
  checksum: string;
  envPath: string;
  exportPath: string;
  keys: string[];
  removedKeys: string[];
};

const VAULT_ROOT = process.env.VAULTDECK_HOME || path.join(os.homedir(), ".vaultdeck");
const PATHS = {
  root: VAULT_ROOT,
  entries: path.join(VAULT_ROOT, "entries"),
  files: path.join(VAULT_ROOT, "files"),
  projects: path.join(VAULT_ROOT, "projects"),
  meta: path.join(VAULT_ROOT, "meta"),
  backups: path.join(VAULT_ROOT, "backups"),
  entriesIndex: path.join(VAULT_ROOT, "meta", "entries.json"),
  projectsIndex: path.join(VAULT_ROOT, "meta", "projects.json"),
  filesIndex: path.join(VAULT_ROOT, "meta", "files.json"),
  activityIndex: path.join(VAULT_ROOT, "meta", "activity.json"),
  envGenerated: path.join(VAULT_ROOT, ".env.generated"),
  envExports: path.join(VAULT_ROOT, ".env.exports.sh"),
  envMeta: path.join(VAULT_ROOT, "meta", "env-generation.json"),
};

async function secureMkdir(dirPath: string) {
  await fs.mkdir(dirPath, { recursive: true, mode: 0o700 });
  await fs.chmod(dirPath, 0o700).catch(() => {});
}

async function secureWriteFile(filePath: string, content: string) {
  await fs.writeFile(filePath, content, { encoding: "utf8", mode: 0o600 });
  await fs.chmod(filePath, 0o600).catch(() => {});
}

async function ensureFile<T>(filePath: string, fallback: T) {
  try {
    await fs.access(filePath);
    await fs.chmod(filePath, 0o600).catch(() => {});
  } catch {
    await secureWriteFile(filePath, JSON.stringify(fallback, null, 2));
  }
}

async function ensureTextFile(filePath: string, text = "") {
  try {
    await fs.access(filePath);
    await fs.chmod(filePath, 0o600).catch(() => {});
  } catch {
    await secureWriteFile(filePath, text);
  }
}

export async function ensureVaultStructure() {
  await secureMkdir(PATHS.root);
  await secureMkdir(PATHS.entries);
  await secureMkdir(PATHS.files);
  await secureMkdir(PATHS.projects);
  await secureMkdir(PATHS.meta);
  await secureMkdir(PATHS.backups);
  await ensureFile(PATHS.entriesIndex, [] as VaultEntry[]);
  await ensureFile(PATHS.projectsIndex, [] as VaultProject[]);
  await ensureFile(PATHS.filesIndex, [] as VaultFile[]);
  await ensureFile(PATHS.activityIndex, [] as ActivityItem[]);
  await ensureFile(PATHS.envMeta, {});
  await ensureTextFile(PATHS.envGenerated, "");
  await ensureTextFile(PATHS.envExports, "");
}

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  await ensureVaultStructure();
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJson<T>(filePath: string, value: T) {
  await secureWriteFile(filePath, JSON.stringify(value, null, 2));
}

function sanitizeEnvKey(input: string): string {
  const normalized = input.trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_").replace(/_+/g, "_");
  return normalized.replace(/^[^A-Z_]+/, "");
}

function shellQuote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/\"/g, '\\\"').replace(/\$/g, "\\$").replace(/`/g, "\\`")}"`;
}

function dotenvQuote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/\"/g, '\\\"').replace(/\n/g, "\\n")}"`;
}

async function writeEntryFile(entry: VaultEntry) {
  const filePath = path.join(PATHS.entries, `${entry.id}.json`);
  await writeJson(filePath, entry);
}

async function removeEntryFile(id: string) {
  await fs.rm(path.join(PATHS.entries, `${id}.json`), { force: true });
}

export async function logActivity(action: string, target: string) {
  const activity = await readJson<ActivityItem[]>(PATHS.activityIndex, []);
  activity.unshift({ id: randomUUID(), action, target, at: new Date().toISOString() });
  await writeJson(PATHS.activityIndex, activity.slice(0, 100));
}

export async function listEntries() {
  await ensureVaultStructure();
  const files = await fs.readdir(PATHS.entries);
  const entries: VaultEntry[] = [];

  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    const fullPath = path.join(PATHS.entries, file);
    try {
      const raw = JSON.parse(await fs.readFile(fullPath, "utf8")) as Partial<VaultEntry>;
      if (!raw.id || !raw.name || !raw.value) continue;
      entries.push({
        id: raw.id,
        name: raw.name,
        key: raw.key || "",
        type: raw.type || "Other",
        value: raw.value,
        description: raw.description,
        project: raw.project,
        tags: raw.tags || [],
        favorite: !!raw.favorite,
        includeInEnv: raw.includeInEnv ?? true,
        createdAt: raw.createdAt || raw.updatedAt || new Date().toISOString(),
        updatedAt: raw.updatedAt || new Date().toISOString(),
      });
    } catch {
      // skip invalid entry file
    }
  }

  entries.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  await writeJson(PATHS.entriesIndex, entries);
  return entries;
}

export async function upsertEntry(
  input: Omit<VaultEntry, "id" | "updatedAt" | "createdAt"> & { id?: string; createdAt?: string }
) {
  const entries = await listEntries();
  const existing = input.id ? entries.find((e) => e.id === input.id) : undefined;
  const entry: VaultEntry = {
    ...input,
    id: input.id || randomUUID(),
    key: sanitizeEnvKey(input.key || input.name || ""),
    createdAt: existing?.createdAt || input.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const idx = entries.findIndex((e) => e.id === entry.id);
  if (idx >= 0) entries[idx] = entry;
  else entries.unshift(entry);

  await writeEntryFile(entry);
  await writeJson(PATHS.entriesIndex, entries);
  await logActivity(idx >= 0 ? "Updated entry" : "Created entry", entry.name);
  return entry;
}

export async function deleteEntry(id: string) {
  const entries = await listEntries();
  const found = entries.find((e) => e.id === id);
  await removeEntryFile(id);
  const next = entries.filter((e) => e.id !== id);
  await writeJson(PATHS.entriesIndex, next);
  if (found) await logActivity("Deleted entry", found.name);
}

export async function listProjects() {
  return readJson<VaultProject[]>(PATHS.projectsIndex, []);
}

export async function upsertProject(input: Omit<VaultProject, "id" | "updatedAt"> & { id?: string }) {
  const projects = await listProjects();
  const project: VaultProject = {
    ...input,
    id: input.id || randomUUID(),
    updatedAt: new Date().toISOString(),
  };
  const idx = projects.findIndex((p) => p.id === project.id);
  if (idx >= 0) projects[idx] = project;
  else projects.unshift(project);
  await writeJson(PATHS.projectsIndex, projects);
  await logActivity(idx >= 0 ? "Updated project" : "Created project", project.name);
  return project;
}

export async function deleteProject(id: string) {
  const projects = await listProjects();
  const found = projects.find((p) => p.id === id);
  await writeJson(PATHS.projectsIndex, projects.filter((p) => p.id !== id));
  if (found) await logActivity("Deleted project", found.name);
}

export async function listFiles() {
  return readJson<VaultFile[]>(PATHS.filesIndex, []);
}

export async function saveFile(params: {
  buffer: Buffer;
  originalName: string;
  mimeType: string;
  project?: string;
  tags?: string[];
}) {
  const now = new Date().toISOString();
  const id = randomUUID();
  const ext = path.extname(params.originalName) || "";
  const safeBase = path.basename(params.originalName, ext).replace(/[^a-zA-Z0-9-_]/g, "-");
  const name = `${safeBase}-${id.slice(0, 8)}${ext}`;
  const fullPath = path.join(PATHS.files, name);
  const resolved = path.resolve(fullPath);
  const filesRoot = path.resolve(PATHS.files) + path.sep;
  if (!resolved.startsWith(filesRoot)) throw new Error("Invalid upload path");

  await fs.writeFile(resolved, params.buffer, { mode: 0o600 });
  await fs.chmod(resolved, 0o600).catch(() => {});
  const files = await listFiles();
  const meta: VaultFile = {
    id,
    name,
    originalName: params.originalName,
    mimeType: params.mimeType || "application/octet-stream",
    size: params.buffer.length,
    project: params.project,
    tags: params.tags || [],
    updatedAt: now,
    path: resolved,
  };
  files.unshift(meta);
  await writeJson(PATHS.filesIndex, files);
  await logActivity("Uploaded file", params.originalName);
  return meta;
}

export async function renameFile(id: string, originalName: string) {
  const files = await listFiles();
  const file = files.find((f) => f.id === id);
  if (!file) throw new Error("File not found");
  file.originalName = originalName;
  file.updatedAt = new Date().toISOString();
  await writeJson(PATHS.filesIndex, files);
  await logActivity("Renamed file", originalName);
  return file;
}

export async function deleteFile(id: string) {
  const files = await listFiles();
  const file = files.find((f) => f.id === id);
  if (!file) return;
  await fs.rm(file.path, { force: true });
  await writeJson(PATHS.filesIndex, files.filter((f) => f.id !== id));
  await logActivity("Deleted file", file.originalName);
}

export async function generateEnvFiles() {
  const entries = await listEntries();
  const previousMeta = await readJson<Partial<EnvGenerationResult>>(PATHS.envMeta, {});
  const previousKeys = new Set(previousMeta.keys || []);
  const envEntries = entries.filter((e) => e.includeInEnv && e.value.trim().length > 0);
  const duplicateKeys = new Set<string>();
  const invalidNames = new Set<string>();
  const keySeen = new Set<string>();
  const rows: { key: string; value: string }[] = [];

  for (const entry of envEntries) {
    const key = sanitizeEnvKey(entry.key || entry.name);
    if (!key) {
      invalidNames.add(entry.name);
      continue;
    }
    if (keySeen.has(key)) duplicateKeys.add(key);
    keySeen.add(key);
    rows.push({ key, value: entry.value });
  }

  rows.sort((a, b) => a.key.localeCompare(b.key));

  const keys = rows.map((r) => r.key);
  const removedKeys = [...previousKeys].filter((k) => !keys.includes(k)).sort((a, b) => a.localeCompare(b));

  const envContent = rows.map((r) => `${r.key}=${dotenvQuote(r.value)}`).join("\n") + (rows.length ? "\n" : "");
  const exportLines = [
    "# VaultDeck managed exports",
    ...removedKeys.map((k) => `unset ${k}`),
    ...rows.map((r) => `export ${r.key}=${shellQuote(r.value)}`),
  ];
  const exportContent = exportLines.join("\n") + "\n";

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const previousEnv = await fs.readFile(PATHS.envGenerated, "utf8").catch(() => "");
  const previousExports = await fs.readFile(PATHS.envExports, "utf8").catch(() => "");
  if (previousEnv || previousExports) {
    const backupDir = path.join(PATHS.backups, `env-${stamp}`);
    await secureMkdir(backupDir);
    if (previousEnv) await secureWriteFile(path.join(backupDir, ".env.generated"), previousEnv);
    if (previousExports) await secureWriteFile(path.join(backupDir, ".env.exports.sh"), previousExports);
  }

  await secureWriteFile(PATHS.envGenerated, envContent);
  await secureWriteFile(PATHS.envExports, exportContent);

  const generatedAt = new Date().toISOString();
  const checksum = createHash("sha256").update(`${envContent}\n---\n${exportContent}`).digest("hex");
  const result: EnvGenerationResult = {
    envCount: rows.length,
    duplicateKeys: [...duplicateKeys],
    invalidNames: [...invalidNames],
    generatedAt,
    checksum,
    envPath: PATHS.envGenerated,
    exportPath: PATHS.envExports,
    keys,
    removedKeys,
  };

  await writeJson(PATHS.envMeta, result);
  await logActivity("Generated env files", `${rows.length} variables`);
  return result;
}

async function filePerm(pathName: string) {
  try {
    const st = await fs.stat(pathName);
    return st.mode & 0o777;
  } catch {
    return null;
  }
}

export async function envStatus() {
  const entries = await listEntries();
  const envCompatible = entries.filter((e) => e.includeInEnv).length;
  const last = await readJson<Partial<EnvGenerationResult>>(PATHS.envMeta, {});

  const perms = {
    vault: await filePerm(PATHS.root),
    env: await filePerm(PATHS.envGenerated),
    exports: await filePerm(PATHS.envExports),
  };

  const permissionWarnings: string[] = [];
  if (perms.vault !== null && perms.vault !== 0o700) permissionWarnings.push(`Vault dir expected 700, got ${perms.vault.toString(8)}`);
  if (perms.env !== null && perms.env !== 0o600) permissionWarnings.push(`.env.generated expected 600, got ${perms.env.toString(8)}`);
  if (perms.exports !== null && perms.exports !== 0o600) permissionWarnings.push(`.env.exports.sh expected 600, got ${perms.exports.toString(8)}`);

  return {
    vaultPath: PATHS.root,
    envPath: PATHS.envGenerated,
    exportPath: PATHS.envExports,
    envCompatible,
    shellLine: '[ -f "$HOME/.vaultdeck/.env.exports.sh" ] && source "$HOME/.vaultdeck/.env.exports.sh"',
    generatedAt: last.generatedAt || null,
    duplicateKeys: last.duplicateKeys || [],
    invalidNames: last.invalidNames || [],
    checksum: last.checksum || null,
    envExists: await fs.access(PATHS.envGenerated).then(() => true).catch(() => false),
    exportsExists: await fs.access(PATHS.envExports).then(() => true).catch(() => false),
    permissions: {
      vault: perms.vault !== null ? perms.vault.toString(8) : null,
      env: perms.env !== null ? perms.env.toString(8) : null,
      exports: perms.exports !== null ? perms.exports.toString(8) : null,
    },
    permissionWarnings,
  };
}

export async function dashboardSummary() {
  const [entries, projects, files, activity] = await Promise.all([
    listEntries(),
    listProjects(),
    listFiles(),
    readJson<ActivityItem[]>(PATHS.activityIndex, []),
  ]);
  const favorites = entries.filter((e) => e.favorite).length;
  return {
    counts: {
      entries: entries.length,
      files: files.length,
      projects: projects.length,
      favorites,
      envCompatible: entries.filter((e) => e.includeInEnv).length,
    },
    recent: activity.slice(0, 8),
    categories: entries.reduce<Record<string, number>>((acc, cur) => {
      acc[cur.type] = (acc[cur.type] || 0) + 1;
      return acc;
    }, {}),
  };
}

export { PATHS, VAULT_ROOT, VAULT_TYPES, sanitizeEnvKey };
