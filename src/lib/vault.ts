import { promises as fs } from "fs";
import path from "path";
import os from "os";
import { randomUUID, createHash } from "crypto";
import {
  ProjectStatus,
  SecretValueType,
  ShellType,
  VAULT_TYPES,
  VaultEntry,
  VaultFile,
  VaultProject,
} from "@/lib/models";

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
  globalEnvEnabled?: boolean;
  globalEnvPath?: string;
  globalEnvGenerated?: boolean;
};

export type ProjectSummary = VaultProject & {
  secretCount: number;
  fileCount: number;
};

export type ProjectRuntime = {
  shellPreview: string;
  nodeTest: string;
  pythonTest: string;
  curlTest: string;
};

export type ProjectDetail = {
  project: VaultProject;
  secrets: VaultEntry[];
  files: VaultFile[];
  metadata: {
    envCount: number;
    fileCount: number;
    secretCount: number;
    lastInjectionAt: string | null;
    lastModifiedAt: string;
  };
  runtime: ProjectRuntime;
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
  settings: path.join(VAULT_ROOT, "meta", "settings.json"),
  globalEnvDir: path.join(os.homedir(), ".config", "environment.d"),
  globalEnvFile: path.join(os.homedir(), ".config", "environment.d", "90-vaultdeck.conf"),
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
  await ensureFile(PATHS.settings, {});
  await ensureTextFile(PATHS.envGenerated, "");
  await ensureTextFile(PATHS.envExports, "");
  await fs.mkdir(PATHS.globalEnvDir, { recursive: true, mode: 0o700 }).catch(() => {});
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

async function getSettings() {
  const settings = await readJson<{ globalEnv?: { enabled?: boolean } }>(PATHS.settings, {});
  return { globalEnv: { enabled: settings?.globalEnv?.enabled === true } };
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

function envdQuote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/\"/g, '\\\"').replace(/\n/g, "\\n")}"`;
}

function isPosixEnvKey(key: string): boolean {
  return /^[A-Z_][A-Z0-9_]*$/.test(key);
}

function projectSlug(name: string) {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || `project-${randomUUID().slice(0, 8)}`;
}

function normalizeProjectStatus(status?: string): ProjectStatus {
  if (status === "disabled" || status === "system") return status;
  return "active";
}

function normalizeShell(shell?: string): ShellType {
  if (shell === "bash" || shell === "fish") return shell;
  return "zsh";
}

function inferSecretType(type: VaultEntry["type"], explicit?: SecretValueType): SecretValueType {
  if (explicit) return explicit;
  if (type === "Token") return "token";
  if (type === "JSON Credential") return "json";
  return "string";
}

function parseEnvContent(content: string) {
  const rows: { key: string; value: string }[] = [];
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const rawKey = trimmed.slice(0, eq).trim();
    const key = sanitizeEnvKey(rawKey);
    if (!key) continue;
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    value = value.replace(/\\n/g, "\n");
    rows.push({ key, value });
  }
  return rows;
}

async function writeEntryFile(entry: VaultEntry) {
  const filePath = path.join(PATHS.entries, `${entry.id}.json`);
  await writeJson(filePath, entry);
}

async function removeEntryFile(id: string) {
  await fs.rm(path.join(PATHS.entries, `${id}.json`), { force: true });
}

async function ensureProjectFolder(project: Pick<VaultProject, "id" | "name" | "folderPath">) {
  const preferred = project.folderPath || path.join(PATHS.projects, projectSlug(project.name));
  const resolvedPreferred = path.resolve(preferred);
  const projectsRoot = path.resolve(PATHS.projects) + path.sep;
  if (!resolvedPreferred.startsWith(projectsRoot)) {
    const fallback = path.join(PATHS.projects, `${projectSlug(project.name)}-${project.id.slice(0, 6)}`);
    await secureMkdir(fallback);
    return fallback;
  }

  try {
    await secureMkdir(resolvedPreferred);
    return resolvedPreferred;
  } catch {
    const fallback = path.join(PATHS.projects, `${projectSlug(project.name)}-${project.id.slice(0, 6)}`);
    await secureMkdir(fallback);
    return fallback;
  }
}

function normalizeProject(raw: Partial<VaultProject>): VaultProject {
  const id = raw.id || randomUUID();
  const updatedAt = raw.updatedAt || new Date().toISOString();
  const createdAt = raw.createdAt || updatedAt;
  return {
    id,
    name: raw.name || "Untitled Project",
    description: raw.description || "",
    color: raw.color || "#38bdf8",
    status: normalizeProjectStatus(raw.status),
    defaultShell: normalizeShell(raw.defaultShell),
    folderPath: raw.folderPath || path.join(PATHS.projects, projectSlug(raw.name || id)),
    createdAt,
    updatedAt,
    lastInjectedAt: raw.lastInjectedAt,
  };
}

function sortedByUpdatedDesc<T extends { updatedAt: string }>(rows: T[]) {
  return rows.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

function maskValue(value: string) {
  if (!value) return "***";
  const shown = value.slice(0, Math.min(3, value.length));
  return `${shown}***`;
}

function projectRowsForEnv(secrets: VaultEntry[], includeMasked = false) {
  const rows = secrets
    .filter((entry) => entry.includeInEnv && entry.value.trim().length > 0)
    .map((entry) => ({ key: sanitizeEnvKey(entry.key || entry.name), value: entry.value }))
    .filter((row) => !!row.key)
    .sort((a, b) => a.key.localeCompare(b.key));

  if (!includeMasked) return rows;
  return rows.map((row) => ({ ...row, value: maskValue(row.value) }));
}

function renderEnvFile(rows: { key: string; value: string }[]) {
  return rows.map((row) => `${row.key}=${dotenvQuote(row.value)}`).join("\n") + (rows.length ? "\n" : "");
}

function renderJsonFile(rows: { key: string; value: string }[]) {
  const obj = rows.reduce<Record<string, string>>((acc, cur) => {
    acc[cur.key] = cur.value;
    return acc;
  }, {});
  return `${JSON.stringify(obj, null, 2)}\n`;
}

function runtimeTests(rows: { key: string; value: string }[]) {
  const first = rows[0]?.key || "OPENAI_API_KEY";
  return {
    shellPreview: ["# VaultDeck project shell preview", ...rows.map((r) => `export ${r.key}=${shellQuote(maskValue(r.value))}`)].join("\n"),
    nodeTest:
      `node -e "if (!process.env.${first}) { throw new Error('${first} missing') } console.log('${first} ok')"`,
    pythonTest:
      `python -c \"import os,sys; key='${first}'; v=os.getenv(key); print(f'{key} ok' if v else f'{key} missing'); sys.exit(0 if v else 1)\"`,
    curlTest: `curl -s https://httpbin.org/headers -H \"Authorization: Bearer \$${first}\" | jq '.headers.Authorization'`,
  };
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
      if (!raw.id || !raw.name || typeof raw.value !== "string") continue;
      const type = VAULT_TYPES.includes((raw.type || "Other") as VaultEntry["type"]) ? (raw.type as VaultEntry["type"]) : "Other";
      entries.push({
        id: raw.id,
        name: raw.name,
        key: raw.key || "",
        type,
        secretType: inferSecretType(type, raw.secretType),
        value: raw.value,
        description: raw.description,
        project: raw.project,
        projectId: raw.projectId,
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

  sortedByUpdatedDesc(entries);
  await writeJson(PATHS.entriesIndex, entries);
  return entries;
}

export async function upsertEntry(
  input: Omit<VaultEntry, "id" | "updatedAt" | "createdAt"> & { id?: string; createdAt?: string }
) {
  const entries = await listEntries();
  const existing = input.id ? entries.find((e) => e.id === input.id) : undefined;

  let projectName = input.project;
  if (input.projectId) {
    const project = (await listProjects()).find((p) => p.id === input.projectId);
    if (project) projectName = project.name;
  }

  const type = (input.type && VAULT_TYPES.includes(input.type)) ? input.type : "Other";
  const entry: VaultEntry = {
    ...input,
    id: input.id || randomUUID(),
    key: sanitizeEnvKey(input.key || input.name || ""),
    type,
    secretType: inferSecretType(type, input.secretType || existing?.secretType),
    project: projectName,
    projectId: input.projectId || existing?.projectId,
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
  const raw = await readJson<Partial<VaultProject>[]>(PATHS.projectsIndex, []);
  const normalized = sortedByUpdatedDesc(raw.map(normalizeProject));
  await writeJson(PATHS.projectsIndex, normalized);
  return normalized;
}

export async function listProjectSummaries(params?: { q?: string; status?: ProjectStatus | "all" }) {
  const [projects, entries, files] = await Promise.all([listProjects(), listEntries(), listFiles()]);
  const q = (params?.q || "").trim().toLowerCase();
  const status = params?.status || "all";

  const filteredProjects = projects.filter((project) => {
    if (status !== "all" && project.status !== status) return false;
    if (!q) return true;
    return [project.name, project.description || "", project.id].join(" ").toLowerCase().includes(q);
  });

  return filteredProjects.map<ProjectSummary>((project) => {
    const secretCount = entries.filter((e) => e.projectId === project.id || (!e.projectId && e.project === project.name)).length;
    const fileCount = files.filter((f) => f.projectId === project.id || (!f.projectId && f.project === project.name)).length;
    return { ...project, secretCount, fileCount };
  });
}

export async function getProjectById(id: string) {
  return (await listProjects()).find((project) => project.id === id) || null;
}

export async function upsertProject(
  input: Partial<Omit<VaultProject, "updatedAt" | "createdAt" | "folderPath">> & {
    id?: string;
    name: string;
    description?: string;
    color?: string;
    status?: ProjectStatus;
    defaultShell?: ShellType;
  }
) {
  const projects = await listProjects();
  const existing = input.id ? projects.find((p) => p.id === input.id) : undefined;
  const id = input.id || randomUUID();
  const now = new Date().toISOString();

  const base: VaultProject = normalizeProject({
    id,
    name: input.name,
    description: input.description,
    color: input.color,
    status: input.status,
    defaultShell: input.defaultShell,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    folderPath: existing?.folderPath,
    lastInjectedAt: existing?.lastInjectedAt,
  });

  const folderPath = await ensureProjectFolder(base);
  const project = { ...base, folderPath };

  const idx = projects.findIndex((p) => p.id === id);
  if (idx >= 0) projects[idx] = project;
  else projects.unshift(project);

  await writeJson(PATHS.projectsIndex, sortedByUpdatedDesc(projects));
  await logActivity(idx >= 0 ? "Updated project" : "Created project", project.name);
  return project;
}

export async function deleteProject(id: string) {
  const [projects, entries, files] = await Promise.all([listProjects(), listEntries(), listFiles()]);
  const found = projects.find((p) => p.id === id);
  if (!found) return;

  const nextProjects = projects.filter((p) => p.id !== id);
  await writeJson(PATHS.projectsIndex, nextProjects);

  for (const entry of entries) {
    if (entry.projectId === id || (!entry.projectId && entry.project === found.name)) {
      await deleteEntry(entry.id);
    }
  }

  const updatedFiles = files.map((file) => {
    if (file.projectId === id || (!file.projectId && file.project === found.name)) {
      return { ...file, projectId: undefined, project: undefined, updatedAt: new Date().toISOString() };
    }
    return file;
  });
  await writeJson(PATHS.filesIndex, updatedFiles);

  await logActivity("Deleted project", found.name);
}

export async function duplicateProject(id: string) {
  const source = await getProjectById(id);
  if (!source) throw new Error("Project not found");
  const targetName = `${source.name} Copy`;
  const project = await upsertProject({
    name: targetName,
    description: source.description,
    color: source.color,
    status: source.status,
    defaultShell: source.defaultShell,
  });

  const sourceSecrets = await listProjectEntries(id);
  for (const secret of sourceSecrets) {
    await upsertEntry({
      name: secret.name,
      key: secret.key,
      type: secret.type,
      secretType: secret.secretType,
      value: secret.value,
      description: secret.description,
      projectId: project.id,
      project: project.name,
      tags: [...secret.tags],
      favorite: secret.favorite,
      includeInEnv: secret.includeInEnv,
    });
  }

  await logActivity("Duplicated project", `${source.name} -> ${project.name}`);
  return project;
}

export async function listFiles(): Promise<VaultFile[]> {
  const rows = await readJson<VaultFile[]>(PATHS.filesIndex, []);
  const normalized: VaultFile[] = rows.map((file) => ({
    ...file,
    projectId: file.projectId,
    project: file.project,
    updatedAt: file.updatedAt || new Date().toISOString(),
  }));
  await writeJson(PATHS.filesIndex, normalized);
  return normalized;
}

export async function saveFile(params: {
  buffer: Buffer;
  originalName: string;
  mimeType: string;
  project?: string;
  projectId?: string;
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

  let projectName = params.project;
  if (params.projectId) {
    const project = await getProjectById(params.projectId);
    if (project) projectName = project.name;
  }

  await fs.writeFile(resolved, params.buffer, { mode: 0o600 });
  await fs.chmod(resolved, 0o600).catch(() => {});
  const files = await listFiles();
  const meta: VaultFile = {
    id,
    name,
    originalName: params.originalName,
    mimeType: params.mimeType || "application/octet-stream",
    size: params.buffer.length,
    project: projectName,
    projectId: params.projectId,
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

export async function setFileProject(id: string, projectId?: string) {
  const files = await listFiles();
  const file = files.find((f) => f.id === id);
  if (!file) throw new Error("File not found");

  let projectName: string | undefined;
  if (projectId) {
    const project = await getProjectById(projectId);
    if (!project) throw new Error("Project not found");
    projectName = project.name;
  }

  file.projectId = projectId;
  file.project = projectName;
  file.updatedAt = new Date().toISOString();
  await writeJson(PATHS.filesIndex, files);
  await logActivity("Updated file project", file.originalName);
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

export async function listProjectEntries(projectId: string) {
  const [entries, project] = await Promise.all([listEntries(), getProjectById(projectId)]);
  if (!project) return [];
  return entries.filter((entry) => entry.projectId === projectId || (!entry.projectId && entry.project === project.name));
}

export async function listProjectFiles(projectId: string) {
  const [files, project] = await Promise.all([listFiles(), getProjectById(projectId)]);
  if (!project) return [];
  return files.filter((file) => file.projectId === projectId || (!file.projectId && file.project === project.name));
}

export async function getProjectDetail(projectId: string): Promise<ProjectDetail | null> {
  const project = await getProjectById(projectId);
  if (!project) return null;

  const [secrets, files] = await Promise.all([listProjectEntries(projectId), listProjectFiles(projectId)]);
  const rows = projectRowsForEnv(secrets, true);
  const runtime = runtimeTests(rows);

  const lastModified = [project.updatedAt, ...secrets.map((s) => s.updatedAt), ...files.map((f) => f.updatedAt)].sort().at(-1) || project.updatedAt;

  return {
    project,
    secrets: sortedByUpdatedDesc(secrets),
    files: sortedByUpdatedDesc(files),
    metadata: {
      envCount: secrets.filter((s) => s.includeInEnv).length,
      fileCount: files.length,
      secretCount: secrets.length,
      lastInjectionAt: project.lastInjectedAt || null,
      lastModifiedAt: lastModified,
    },
    runtime,
  };
}

export async function markProjectInjected(projectId: string) {
  const project = await getProjectById(projectId);
  if (!project) throw new Error("Project not found");
  const updated = await upsertProject({
    id: project.id,
    name: project.name,
    description: project.description,
    color: project.color,
    status: project.status,
    defaultShell: project.defaultShell,
  });
  updated.lastInjectedAt = new Date().toISOString();
  const projects = await listProjects();
  const idx = projects.findIndex((p) => p.id === updated.id);
  if (idx >= 0) {
    projects[idx] = { ...projects[idx], lastInjectedAt: updated.lastInjectedAt };
    await writeJson(PATHS.projectsIndex, projects);
  }
  await logActivity("Injected project environment", updated.name);
  return updated;
}

export async function exportProjectVariables(projectId: string, format: "env" | "json") {
  const detail = await getProjectDetail(projectId);
  if (!detail) throw new Error("Project not found");
  const rows = projectRowsForEnv(detail.secrets);
  if (format === "json") return renderJsonFile(rows);
  return renderEnvFile(rows);
}

export async function importProjectVariables(projectId: string, format: "env" | "json", content: string) {
  const project = await getProjectById(projectId);
  if (!project) throw new Error("Project not found");

  const rows: { key: string; value: string; secretType: SecretValueType }[] = [];
  if (format === "env") {
    for (const row of parseEnvContent(content)) {
      rows.push({ ...row, secretType: "string" });
    }
  } else {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    for (const [rawKey, value] of Object.entries(parsed)) {
      const key = sanitizeEnvKey(rawKey);
      if (!key) continue;
      if (typeof value === "string") rows.push({ key, value, secretType: "string" });
      else if (typeof value === "number" || typeof value === "boolean") rows.push({ key, value: String(value), secretType: "string" });
      else rows.push({ key, value: JSON.stringify(value), secretType: "json" });
    }
  }

  let count = 0;
  const existing = await listProjectEntries(projectId);
  const existingByKey = new Map(existing.map((item) => [sanitizeEnvKey(item.key || item.name), item]));

  for (const row of rows) {
    const prior = existingByKey.get(row.key);
    await upsertEntry({
      id: prior?.id,
      name: prior?.name || row.key,
      key: row.key,
      type: row.secretType === "json" ? "JSON Credential" : row.secretType === "token" ? "Token" : "Env Variable",
      secretType: row.secretType,
      value: row.value,
      description: prior?.description || "Imported variable",
      projectId,
      project: project.name,
      tags: prior?.tags || ["imported"],
      favorite: prior?.favorite || false,
      includeInEnv: prior?.includeInEnv ?? true,
      createdAt: prior?.createdAt,
    });
    count += 1;
  }

  await logActivity("Imported project variables", `${project.name} (${count})`);
  return { imported: count };
}

export async function generateEnvFiles() {
  const [entries, projects] = await Promise.all([listEntries(), listProjects()]);
  const previousMeta = await readJson<Partial<EnvGenerationResult>>(PATHS.envMeta, {});
  const previousKeys = new Set(previousMeta.keys || []);
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const projectByName = new Map(projects.map((project) => [project.name, project]));

  const envEntries = entries.filter((entry) => {
    if (!entry.includeInEnv || entry.value.trim().length === 0) return false;
    const project = (entry.projectId && projectById.get(entry.projectId)) || (entry.project && projectByName.get(entry.project));
    if (!project) return true;
    return project.status !== "disabled";
  });

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

  const settings = await getSettings();
  let globalEnvGenerated = false;
  if (settings.globalEnv.enabled) {
    const globalBody = [
      "# VaultDeck managed global env (systemd user environment.d)",
      ...rows.filter((r) => isPosixEnvKey(r.key)).map((r) => `${r.key}=${envdQuote(r.value)}`),
    ].join("\n") + "\n";

    const prevGlobal = await fs.readFile(PATHS.globalEnvFile, "utf8").catch(() => "");
    if (prevGlobal) {
      const backupDir = path.join(PATHS.backups, `global-env-${stamp}`);
      await secureMkdir(backupDir);
      await secureWriteFile(path.join(backupDir, "90-vaultdeck.conf"), prevGlobal);
    }

    await secureWriteFile(PATHS.globalEnvFile, globalBody);
    globalEnvGenerated = true;
  }

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
    globalEnvEnabled: settings.globalEnv.enabled,
    globalEnvPath: PATHS.globalEnvFile,
    globalEnvGenerated,
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

  const settings = await getSettings();
  const perms = {
    vault: await filePerm(PATHS.root),
    env: await filePerm(PATHS.envGenerated),
    exports: await filePerm(PATHS.envExports),
    global: await filePerm(PATHS.globalEnvFile),
  };

  const permissionWarnings: string[] = [];
  if (perms.vault !== null && perms.vault !== 0o700) permissionWarnings.push(`Vault dir expected 700, got ${perms.vault.toString(8)}`);
  if (perms.env !== null && perms.env !== 0o600) permissionWarnings.push(`.env.generated expected 600, got ${perms.env.toString(8)}`);
  if (perms.exports !== null && perms.exports !== 0o600) permissionWarnings.push(`.env.exports.sh expected 600, got ${perms.exports.toString(8)}`);
  if (settings.globalEnv.enabled && perms.global !== null && perms.global !== 0o600) {
    permissionWarnings.push(`90-vaultdeck.conf expected 600, got ${perms.global.toString(8)}`);
  }

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
      global: perms.global !== null ? perms.global.toString(8) : null,
    },
    globalEnv: {
      enabled: settings.globalEnv.enabled,
      path: PATHS.globalEnvFile,
      exists: await fs.access(PATHS.globalEnvFile).then(() => true).catch(() => false),
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
