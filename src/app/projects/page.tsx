"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ProjectStatus, ShellType } from "@/lib/models";

type ProjectCard = {
  id: string;
  name: string;
  description?: string;
  color: string;
  status: ProjectStatus;
  defaultShell: ShellType;
  secretCount: number;
  fileCount: number;
  updatedAt: string;
};

type Draft = {
  id?: string;
  name: string;
  description: string;
  color: string;
  status: ProjectStatus;
  defaultShell: ShellType;
};

type SearchResult = {
  id: string;
  name: string;
  key: string;
  projectId?: string;
  project?: string;
};

const defaultDraft: Draft = {
  name: "",
  description: "",
  color: "#38bdf8",
  status: "active",
  defaultShell: "zsh",
};

function statusTone(status: ProjectStatus) {
  if (status === "disabled") return "bg-rose-500/20 text-rose-100 border-rose-500/40";
  if (status === "system") return "bg-amber-500/20 text-amber-100 border-amber-500/40";
  return "bg-emerald-500/20 text-emerald-100 border-emerald-500/40";
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

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return res.json() as Promise<T>;
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<ProjectCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<ProjectStatus | "all">("all");
  const [draft, setDraft] = useState<Draft>(defaultDraft);
  const [showEditor, setShowEditor] = useState(false);
  const [globalSearch, setGlobalSearch] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const params = new URLSearchParams();
      if (query.trim()) params.set("q", query.trim());
      if (status !== "all") params.set("status", status);
      try {
        const data = await fetchJson<ProjectCard[]>(`/api/projects?${params.toString()}`);
        if (!cancelled) {
          setProjects(data);
          setLoading(false);
        }
      } catch {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [query, status]);

  const loadProjects = async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    if (status !== "all") params.set("status", status);
    const data = await fetchJson<ProjectCard[]>(`/api/projects?${params.toString()}`);
    setProjects(data);
    setLoading(false);
  };

  useEffect(() => {
    let done = false;
    const run = async () => {
      const q = globalSearch.trim();
      if (!q) {
        setSearchResults([]);
        return;
      }
      const rows = await fetchJson<SearchResult[]>(`/api/entries?q=${encodeURIComponent(q)}`);
      if (!done) setSearchResults(rows.slice(0, 8));
    };
    run().catch(() => {
      if (!done) setSearchResults([]);
    });
    return () => {
      done = true;
    };
  }, [globalSearch]);

  const activeCount = useMemo(() => projects.filter((p) => p.status === "active").length, [projects]);

  const saveProject = async () => {
    if (!draft.name.trim()) return;
    const method = draft.id ? "PUT" : "POST";
    const url = draft.id ? `/api/projects/${draft.id}` : "/api/projects";
    await fetchJson(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    });
    setDraft(defaultDraft);
    setShowEditor(false);
    await loadProjects();
  };

  const editProject = (project: ProjectCard) => {
    setDraft({
      id: project.id,
      name: project.name,
      description: project.description || "",
      color: project.color,
      status: project.status,
      defaultShell: project.defaultShell,
    });
    setShowEditor(true);
  };

  const deleteProject = async (project: ProjectCard) => {
    if (!window.confirm(`Delete project \"${project.name}\" and its secrets?`)) return;
    setBusyId(project.id);
    await fetchJson(`/api/projects/${project.id}`, { method: "DELETE" });
    setBusyId(null);
    await loadProjects();
  };

  const duplicateProject = async (project: ProjectCard) => {
    setBusyId(project.id);
    await fetchJson(`/api/projects/${project.id}/duplicate`, { method: "POST" });
    setBusyId(null);
    await loadProjects();
  };

  const exportProject = async (project: ProjectCard) => {
    setBusyId(project.id);
    const data = await fetchJson<{ content: string }>(`/api/projects/${project.id}?format=env`);
    downloadText(`${project.name}.env`, data.content);
    setBusyId(null);
  };

  return (
    <div className="space-y-6">
      <header className="rounded-2xl border border-white/10 bg-gradient-to-r from-cyan-500/10 via-transparent to-blue-500/10 p-4 shadow-[0_0_50px_rgba(56,189,248,0.15)]">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <input
            className="w-full rounded-xl border border-white/15 bg-black/40 px-3 py-2 text-sm"
            placeholder="Search projects"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button
            className="rounded-xl bg-cyan-400/90 px-4 py-2 text-sm font-semibold text-black hover:bg-cyan-300"
            onClick={() => {
              setDraft(defaultDraft);
              setShowEditor((s) => !s);
            }}
          >
            Create Project
          </button>
          <select
            className="rounded-xl border border-white/15 bg-black/40 px-3 py-2 text-sm"
            value={status}
            onChange={(e) => setStatus(e.target.value as ProjectStatus | "all")}
          >
            <option value="all">All</option>
            <option value="active">Active</option>
            <option value="disabled">Disabled</option>
            <option value="system">System</option>
          </select>
        </div>
        <div className="mt-3 grid gap-2 text-xs text-zinc-300 md:grid-cols-3">
          <p>Projects: {projects.length}</p>
          <p>Active: {activeCount}</p>
          <p>Search env variables across all projects:</p>
        </div>
        <input
          className="mt-2 w-full rounded-xl border border-white/15 bg-black/40 px-3 py-2 text-sm font-mono"
          placeholder="Search env vars (OPENAI_API_KEY, DISCORD_TOKEN...)"
          value={globalSearch}
          onChange={(e) => setGlobalSearch(e.target.value)}
        />
        {searchResults.length > 0 && (
          <div className="mt-2 grid gap-2 md:grid-cols-2">
            {searchResults.map((item) => (
              <Link
                key={item.id}
                href={item.projectId ? `/projects/${item.projectId}` : "/entries"}
                className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs text-zinc-200 hover:border-cyan-300/50"
              >
                <span className="font-mono text-cyan-200">{item.key}</span> in {item.project || "Unassigned"}
              </Link>
            ))}
          </div>
        )}
      </header>

      {showEditor && (
        <section className="rounded-2xl border border-cyan-300/30 bg-black/30 p-4">
          <h2 className="text-lg font-semibold">{draft.id ? "Edit Project" : "New Project"}</h2>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <input
              className="rounded-lg border border-white/10 bg-black/40 p-2"
              placeholder="Project name"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
            <input
              className="rounded-lg border border-white/10 bg-black/40 p-2"
              placeholder="Description"
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            />
            <input
              className="rounded-lg border border-white/10 bg-black/40 p-2 font-mono"
              placeholder="#38bdf8"
              value={draft.color}
              onChange={(e) => setDraft({ ...draft, color: e.target.value })}
            />
            <select
              className="rounded-lg border border-white/10 bg-black/40 p-2"
              value={draft.defaultShell}
              onChange={(e) => setDraft({ ...draft, defaultShell: e.target.value as ShellType })}
            >
              <option value="bash">bash</option>
              <option value="zsh">zsh</option>
              <option value="fish">fish</option>
            </select>
            <select
              className="rounded-lg border border-white/10 bg-black/40 p-2"
              value={draft.status}
              onChange={(e) => setDraft({ ...draft, status: e.target.value as ProjectStatus })}
            >
              <option value="active">active</option>
              <option value="disabled">disabled</option>
              <option value="system">system</option>
            </select>
          </div>
          <div className="mt-3 flex gap-2">
            <button className="rounded-lg bg-cyan-400 px-4 py-2 text-sm font-semibold text-black" onClick={saveProject}>
              Save
            </button>
            <button className="rounded-lg bg-white/10 px-4 py-2 text-sm" onClick={() => setShowEditor(false)}>
              Cancel
            </button>
          </div>
        </section>
      )}

      {loading ? (
        <p className="text-sm text-zinc-400">Loading projects...</p>
      ) : (
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {projects.map((project) => (
            <article
              key={project.id}
              className="rounded-2xl border border-white/10 bg-gradient-to-b from-white/8 to-black/20 p-4 shadow-[0_0_35px_rgba(2,6,23,0.8)]"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold" style={{ color: project.color }}>
                    {project.name}
                  </h3>
                  <p className="mt-1 text-sm text-zinc-400">{project.description || "No description"}</p>
                </div>
                <span className={`rounded-full border px-2 py-1 text-[11px] uppercase ${statusTone(project.status)}`}>
                  {project.status}
                </span>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2 text-xs text-zinc-300">
                <p>
                  <span className="text-zinc-500">Color:</span> {project.color}
                </p>
                <p>
                  <span className="text-zinc-500">Shell:</span> {project.defaultShell}
                </p>
                <p>
                  <span className="text-zinc-500">Secrets:</span> {project.secretCount}
                </p>
                <p>
                  <span className="text-zinc-500">Files:</span> {project.fileCount}
                </p>
                <p className="col-span-2 text-zinc-500">Modified {new Date(project.updatedAt).toLocaleString()}</p>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                <Link href={`/projects/${project.id}`} className="rounded bg-cyan-500/20 px-2 py-1 text-center text-cyan-100">
                  Open
                </Link>
                <button className="rounded bg-white/10 px-2 py-1" onClick={() => editProject(project)}>
                  Edit
                </button>
                <button className="rounded bg-rose-500/20 px-2 py-1 text-rose-100" onClick={() => deleteProject(project)} disabled={busyId === project.id}>
                  Delete
                </button>
                <button className="rounded bg-emerald-500/20 px-2 py-1 text-emerald-100" onClick={() => exportProject(project)} disabled={busyId === project.id}>
                  Export env
                </button>
                <button className="col-span-2 rounded bg-blue-500/20 px-2 py-1 text-blue-100" onClick={() => duplicateProject(project)} disabled={busyId === project.id}>
                  Duplicate Project
                </button>
              </div>
            </article>
          ))}
          {projects.length === 0 && <p className="text-sm text-zinc-500">No projects found.</p>}
        </section>
      )}
    </div>
  );
}
