"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { ProjectStatus, SecretValueType, ShellType, VaultEntry, VaultFile } from "@/lib/models";

const tabs = ["Overview", "Secrets", "Files", "Runtime"] as const;
type TabName = (typeof tabs)[number];

type ProjectDetailResponse = {
  project: {
    id: string;
    name: string;
    description?: string;
    color: string;
    status: ProjectStatus;
    defaultShell: ShellType;
    updatedAt: string;
    folderPath: string;
    lastInjectedAt?: string;
  };
  metadata: {
    envCount: number;
    fileCount: number;
    secretCount: number;
    lastInjectionAt: string | null;
    lastModifiedAt: string;
  };
  secrets: VaultEntry[];
  files: VaultFile[];
  runtime: {
    shellPreview: string;
    nodeTest: string;
    pythonTest: string;
    curlTest: string;
  };
};

type SecretDraft = {
  id?: string;
  name: string;
  key: string;
  secretType: SecretValueType;
  value: string;
  description: string;
};

const defaultSecret: SecretDraft = {
  name: "",
  key: "",
  secretType: "string",
  value: "",
  description: "",
};

function mapSecretTypeToEntryType(secretType: SecretValueType): VaultEntry["type"] {
  if (secretType === "token") return "Token";
  if (secretType === "json") return "JSON Credential";
  return "Env Variable";
}

function maskValue(value: string) {
  if (!value) return "***";
  const head = value.slice(0, Math.min(3, value.length));
  return `${head}***`;
}

function downloadText(filename: string, body: string) {
  const blob = new Blob([body], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

async function copyToClipboard(text: string) {
  if (navigator.clipboard?.writeText && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "absolute";
  ta.style.left = "-9999px";
  document.body.appendChild(ta);
  ta.select();
  document.execCommand("copy");
  document.body.removeChild(ta);
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return res.json() as Promise<T>;
}

export default function ProjectDetailPage() {
  const routeParams = useParams<{ id: string }>();
  const projectId = routeParams.id;
  const [data, setData] = useState<ProjectDetailResponse | null>(null);
  const [tab, setTab] = useState<TabName>("Overview");
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [secretDraft, setSecretDraft] = useState<SecretDraft>(defaultSecret);
  const [showSecretModal, setShowSecretModal] = useState(false);
  const [importFormat, setImportFormat] = useState<"env" | "json">("env");
  const [importText, setImportText] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!projectId) return;
    const detail = await fetchJson<ProjectDetailResponse>(`/api/projects/${projectId}`);
    setData(detail);
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    (async () => {
      try {
        const detail = await fetchJson<ProjectDetailResponse>(`/api/projects/${projectId}`);
        if (!cancelled) setData(detail);
      } catch {
        // no-op
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const exportEnvText = useMemo(() => {
    if (!data) return "";
    return data.secrets
      .filter((secret) => secret.includeInEnv)
      .map((secret) => `${secret.key}=${secret.value}`)
      .join("\n");
  }, [data]);

  const updateProjectStatus = async (status: ProjectStatus) => {
    if (!data) return;
    setBusy(true);
    await fetchJson(`/api/projects/${data.project.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...data.project, status }),
    });
    setBusy(false);
    await load();
  };

  const runInject = async () => {
    if (!data) return;
    setBusy(true);
    await fetchJson(`/api/projects/${data.project.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "inject" }),
    });
    setBusy(false);
    await load();
  };

  const runExport = async (format: "env" | "json") => {
    if (!data) return;
    const out = await fetchJson<{ content: string }>(`/api/projects/${data.project.id}?format=${format}`);
    downloadText(`${data.project.name}.${format === "env" ? "env" : "json"}`, out.content);
  };

  const saveSecret = async () => {
    if (!data || !secretDraft.name || !secretDraft.value) return;
    const payload = {
      name: secretDraft.name,
      key: secretDraft.key || secretDraft.name,
      type: mapSecretTypeToEntryType(secretDraft.secretType),
      secretType: secretDraft.secretType,
      value: secretDraft.value,
      description: secretDraft.description,
      includeInEnv: true,
      tags: ["project"],
    };

    if (secretDraft.id) {
      await fetchJson(`/api/projects/${data.project.id}/secrets/${secretDraft.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } else {
      await fetchJson(`/api/projects/${data.project.id}/secrets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    }

    setSecretDraft(defaultSecret);
    setShowSecretModal(false);
    await load();
  };

  const deleteSecret = async (secret: VaultEntry) => {
    if (!data) return;
    if (!window.confirm(`Delete ${secret.key}?`)) return;
    await fetchJson(`/api/projects/${data.project.id}/secrets/${secret.id}`, { method: "DELETE" });
    await load();
  };

  const importSecrets = async () => {
    if (!data || !importText.trim()) return;
    await fetchJson(`/api/projects/${data.project.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "import", format: importFormat, content: importText }),
    });
    setImportText("");
    await load();
  };

  const uploadFile = async (file: File) => {
    if (!data) return;
    const form = new FormData();
    form.append("file", file);
    form.append("projectId", data.project.id);
    await fetch("/api/files", { method: "POST", body: form });
    await load();
  };

  const createFileReferenceSecret = async (file: VaultFile) => {
    if (!data) return;
    const key = window.prompt("Environment variable key", "GOOGLE_AUTH_FILE");
    if (!key) return;
    await fetchJson(`/api/projects/${data.project.id}/secrets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: key,
        key,
        type: "Env Variable",
        secretType: "file_reference",
        value: file.path,
        description: `File reference to ${file.originalName}`,
      }),
    });
    await load();
  };

  if (!data) return <p className="text-sm text-zinc-400">Loading project control view...</p>;

  return (
    <div className="space-y-6">
      <header className="rounded-2xl border border-white/10 bg-gradient-to-r from-white/5 to-cyan-400/5 p-4 shadow-[0_0_50px_rgba(6,182,212,0.15)]">
        <div className="flex items-center justify-between gap-3">
          <div>
            <Link href="/projects" className="text-xs text-cyan-200 hover:underline">
              Back to Projects
            </Link>
            <h1 className="mt-1 text-2xl font-semibold" style={{ color: data.project.color }}>
              {data.project.name}
            </h1>
            <p className="mt-1 text-sm text-zinc-400">{data.project.description || "No description"}</p>
            <p className="mt-2 text-xs text-zinc-500">Folder: {data.project.folderPath}</p>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <select
              value={data.project.status}
              onChange={(e) => updateProjectStatus(e.target.value as ProjectStatus)}
              disabled={busy}
              className="rounded-lg border border-white/10 bg-black/40 px-3 py-2"
            >
              <option value="active">enabled (active)</option>
              <option value="disabled">disabled</option>
              <option value="system">system</option>
            </select>
          </div>
        </div>
      </header>

      <nav className="flex flex-wrap gap-2">
        {tabs.map((name) => (
          <button
            key={name}
            onClick={() => setTab(name)}
            className={`rounded-lg px-3 py-2 text-sm ${tab === name ? "bg-cyan-400/25 text-cyan-100" : "bg-white/10 text-zinc-300"}`}
          >
            {name}
          </button>
        ))}
      </nav>

      {tab === "Overview" && (
        <section className="space-y-4">
          <div className="grid gap-3 md:grid-cols-4">
            <div className="rounded-xl border border-white/10 bg-black/30 p-3">
              <p className="text-xs text-zinc-500">Env Variables</p>
              <p className="mt-1 text-2xl font-semibold">{data.metadata.envCount}</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/30 p-3">
              <p className="text-xs text-zinc-500">Attached Files</p>
              <p className="mt-1 text-2xl font-semibold">{data.metadata.fileCount}</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/30 p-3">
              <p className="text-xs text-zinc-500">Last Injection</p>
              <p className="mt-1 text-sm">{data.metadata.lastInjectionAt ? new Date(data.metadata.lastInjectionAt).toLocaleString() : "Never"}</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/30 p-3">
              <p className="text-xs text-zinc-500">Last Modified</p>
              <p className="mt-1 text-sm">{new Date(data.metadata.lastModifiedAt).toLocaleString()}</p>
            </div>
          </div>

          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
            <button className="rounded-lg bg-cyan-400/80 px-3 py-2 text-sm font-semibold text-black" onClick={runInject}>
              Inject to shell
            </button>
            <button className="rounded-lg bg-white/10 px-3 py-2 text-sm" onClick={() => runExport("env")}>Export .env</button>
            <button className="rounded-lg bg-white/10 px-3 py-2 text-sm" onClick={() => runExport("json")}>Export JSON</button>
            <button className="rounded-lg bg-white/10 px-3 py-2 text-sm" onClick={() => copyToClipboard(exportEnvText)}>Copy env to clipboard</button>
          </div>

          <div className="rounded-xl border border-white/10 bg-black/30 p-4">
            <h3 className="font-medium">Import Variables</h3>
            <div className="mt-2 flex gap-2">
              <select className="rounded bg-black/40 px-2" value={importFormat} onChange={(e) => setImportFormat(e.target.value as "env" | "json")}>
                <option value="env">Import .env</option>
                <option value="json">Import JSON</option>
              </select>
              <button className="rounded bg-blue-500/25 px-3 py-1 text-sm text-blue-100" onClick={importSecrets}>
                Import
              </button>
            </div>
            <textarea
              className="mt-2 h-32 w-full rounded-lg border border-white/10 bg-black/40 p-2 font-mono text-xs"
              placeholder={importFormat === "env" ? "OPENAI_API_KEY=..." : '{"OPENAI_API_KEY":"..."}'}
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
            />
          </div>
        </section>
      )}

      {tab === "Secrets" && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Project Secrets</h2>
            <button
              className="rounded-lg bg-cyan-400 px-3 py-2 text-sm font-semibold text-black"
              onClick={() => {
                setSecretDraft(defaultSecret);
                setShowSecretModal(true);
              }}
            >
              Add secret
            </button>
          </div>

          <div className="overflow-hidden rounded-xl border border-white/10">
            <table className="w-full text-left text-sm">
              <thead className="bg-white/10 text-xs uppercase text-zinc-400">
                <tr>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Value</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Last updated</th>
                  <th className="px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.secrets.map((secret) => (
                  <tr key={secret.id} className="border-t border-white/10 bg-black/20">
                    <td className="px-3 py-2 font-mono text-cyan-100">{secret.key}</td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {revealed[secret.id] ? secret.value : maskValue(secret.value)}
                    </td>
                    <td className="px-3 py-2 text-xs">{secret.secretType || "string"}</td>
                    <td className="px-3 py-2 text-xs text-zinc-400">{new Date(secret.updatedAt).toLocaleString()}</td>
                    <td className="px-3 py-2 text-xs">
                      <div className="flex gap-2">
                        <button
                          className="rounded bg-white/10 px-2 py-1"
                          onClick={() => {
                            setSecretDraft({
                              id: secret.id,
                              name: secret.name,
                              key: secret.key,
                              secretType: secret.secretType || "string",
                              value: secret.value,
                              description: secret.description || "",
                            });
                            setShowSecretModal(true);
                          }}
                        >
                          Edit
                        </button>
                        <button
                          className="rounded bg-blue-500/20 px-2 py-1 text-blue-100"
                          onClick={() => setRevealed((prev) => ({ ...prev, [secret.id]: !prev[secret.id] }))}
                        >
                          Reveal
                        </button>
                        <button className="rounded bg-rose-500/20 px-2 py-1 text-rose-100" onClick={() => deleteSecret(secret)}>
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.secrets.length === 0 && <p className="p-3 text-sm text-zinc-500">No secrets in this project.</p>}
          </div>
        </section>
      )}

      {tab === "Files" && (
        <section className="space-y-4">
          <div className="rounded-xl border border-white/10 bg-black/30 p-4">
            <h2 className="font-semibold">Attach file from ~/.vaultdeck/files</h2>
            <input
              type="file"
              className="mt-2 rounded-lg border border-white/10 bg-black/40 p-2 text-sm"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  uploadFile(file).catch(() => undefined);
                  e.currentTarget.value = "";
                }
              }}
            />
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            {data.files.map((file) => (
              <div key={file.id} className="rounded-xl border border-white/10 bg-black/30 p-3">
                <p className="font-medium">{file.originalName}</p>
                <p className="mt-1 text-xs text-zinc-400">{file.path}</p>
                <p className="mt-1 text-xs text-zinc-500">{file.mimeType} • {(file.size / 1024).toFixed(1)}KB</p>
                <button className="mt-3 rounded bg-cyan-500/20 px-2 py-1 text-xs text-cyan-100" onClick={() => createFileReferenceSecret(file)}>
                  Create file reference env var
                </button>
              </div>
            ))}
          </div>
          {data.files.length === 0 && <p className="text-sm text-zinc-500">No files attached.</p>}
        </section>
      )}

      {tab === "Runtime" && (
        <section className="space-y-4">
          <div className="rounded-xl border border-white/10 bg-black/30 p-4">
            <h2 className="font-semibold">Shell Export Preview</h2>
            <pre className="mt-2 overflow-x-auto rounded bg-black/40 p-3 text-xs text-cyan-100">{data.runtime.shellPreview}</pre>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-xl border border-white/10 bg-black/30 p-3">
              <p className="text-xs text-zinc-500">Node test</p>
              <pre className="mt-2 overflow-x-auto rounded bg-black/40 p-2 text-xs">{data.runtime.nodeTest}</pre>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/30 p-3">
              <p className="text-xs text-zinc-500">Python test</p>
              <pre className="mt-2 overflow-x-auto rounded bg-black/40 p-2 text-xs">{data.runtime.pythonTest}</pre>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/30 p-3">
              <p className="text-xs text-zinc-500">Curl test</p>
              <pre className="mt-2 overflow-x-auto rounded bg-black/40 p-2 text-xs">{data.runtime.curlTest}</pre>
            </div>
          </div>
        </section>
      )}

      {showSecretModal && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4">
          <div className="w-full max-w-xl rounded-2xl border border-cyan-300/30 bg-[#0a111f] p-4">
            <h3 className="text-lg font-semibold">{secretDraft.id ? "Edit secret" : "Add secret"}</h3>
            <div className="mt-3 grid gap-3">
              <input
                className="rounded-lg border border-white/10 bg-black/40 p-2"
                placeholder="Name"
                value={secretDraft.name}
                onChange={(e) => setSecretDraft({ ...secretDraft, name: e.target.value })}
              />
              <input
                className="rounded-lg border border-white/10 bg-black/40 p-2 font-mono"
                placeholder="ENV key"
                value={secretDraft.key}
                onChange={(e) => setSecretDraft({ ...secretDraft, key: e.target.value })}
              />
              <select
                className="rounded-lg border border-white/10 bg-black/40 p-2"
                value={secretDraft.secretType}
                onChange={(e) => setSecretDraft({ ...secretDraft, secretType: e.target.value as SecretValueType })}
              >
                <option value="string">string</option>
                <option value="json">json</option>
                <option value="token">token</option>
                <option value="file_reference">file reference</option>
              </select>
              <textarea
                className="h-28 rounded-lg border border-white/10 bg-black/40 p-2 font-mono"
                placeholder="Value"
                value={secretDraft.value}
                onChange={(e) => setSecretDraft({ ...secretDraft, value: e.target.value })}
              />
              <textarea
                className="h-20 rounded-lg border border-white/10 bg-black/40 p-2"
                placeholder="Description"
                value={secretDraft.description}
                onChange={(e) => setSecretDraft({ ...secretDraft, description: e.target.value })}
              />
            </div>
            <div className="mt-4 flex gap-2">
              <button className="rounded bg-cyan-400 px-4 py-2 text-sm font-semibold text-black" onClick={saveSecret}>
                Save
              </button>
              <button
                className="rounded bg-white/10 px-4 py-2 text-sm"
                onClick={() => {
                  setShowSecretModal(false);
                  setSecretDraft(defaultSecret);
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
