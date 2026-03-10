import { promises as fs } from "fs";
import path from "path";
import os from "os";
import { spawn } from "child_process";

const PROJECT_ROOT = process.cwd();
const SETTINGS_FILE = path.join(PROJECT_ROOT, "vaultdeck.settings.json");
const VAULT_ROOT = process.env.VAULTDECK_HOME || path.join(os.homedir(), ".vaultdeck");
const UI_PID_FILE = path.join(VAULT_ROOT, "meta", "ui.pid");
const UI_STATE_FILE = path.join(VAULT_ROOT, "meta", "ui-state.json");
const CLI_BIN = path.join(PROJECT_ROOT, "bin", "vaultdeck");

const DEFAULT_UI_HOST = "127.0.0.1";
const DEFAULT_UI_PORT = 3000;

export type UiSettings = {
  host: string;
  port: number;
  source: "defaults" | "project-file";
  settingsFile: string;
};

export type UiRuntimeStatus = {
  pid: number | null;
  running: boolean;
  responsive: boolean;
  host: string;
  port: number;
  startedAt: string | null;
  url: string;
};

function sanitizeHost(value: unknown): string {
  const host = String(value || "").trim();
  return host || DEFAULT_UI_HOST;
}

function sanitizePort(value: unknown): number {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : DEFAULT_UI_PORT;
}

function displayHost(host: string): string {
  return host === "0.0.0.0" ? "localhost" : host;
}

async function readJsonSafe<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const content = await fs.readFile(filePath, "utf8");
    return JSON.parse(content) as T;
  } catch {
    return fallback;
  }
}

function isPidRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function checkUrl(url: string): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1200);
  try {
    const res = await fetch(url, { signal: controller.signal, cache: "no-store" });
    return res.ok || (res.status >= 300 && res.status < 500);
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

export async function getUiSettings(): Promise<UiSettings> {
  const raw = await readJsonSafe<{ ui?: { host?: unknown; port?: unknown } }>(SETTINGS_FILE, {});
  const hasUi = !!raw.ui;
  return {
    host: sanitizeHost(raw.ui?.host),
    port: sanitizePort(raw.ui?.port),
    source: hasUi ? "project-file" : "defaults",
    settingsFile: SETTINGS_FILE,
  };
}

export async function setUiSettings(input: { host?: unknown; port?: unknown }): Promise<UiSettings> {
  const current = await readJsonSafe<Record<string, unknown>>(SETTINGS_FILE, {});
  const next = {
    ...current,
    ui: {
      host: sanitizeHost(input.host),
      port: sanitizePort(input.port),
    },
  };
  await fs.writeFile(SETTINGS_FILE, `${JSON.stringify(next, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  return getUiSettings();
}

export async function getUiRuntimeStatus(): Promise<UiRuntimeStatus> {
  const settings = await getUiSettings();
  const state = await readJsonSafe<{ pid?: unknown; host?: unknown; port?: unknown; startedAt?: unknown }>(UI_STATE_FILE, {});
  const pidRaw = await fs.readFile(UI_PID_FILE, "utf8").catch(() => "");
  const pid = Number(pidRaw.trim() || state.pid);
  const normalizedPid = Number.isInteger(pid) && pid > 0 ? pid : null;
  const running = normalizedPid !== null && isPidRunning(normalizedPid);
  const host = sanitizeHost(state.host || settings.host);
  const port = sanitizePort(state.port || settings.port);
  const url = `http://${displayHost(host)}:${port}`;
  const responsive = running ? await checkUrl(url) : false;
  const startedAt = typeof state.startedAt === "string" ? state.startedAt : null;
  return { pid: normalizedPid, running, responsive, host, port, startedAt, url };
}

function runDetachedCli(args: string[]) {
  const child = spawn(CLI_BIN, args, {
    cwd: PROJECT_ROOT,
    detached: true,
    stdio: "ignore",
    env: process.env,
  });
  child.unref();
}

export function controlUi(action: "start" | "stop" | "restart") {
  runDetachedCli([action]);
}
