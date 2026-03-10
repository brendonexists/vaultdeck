"use client";

import { useEffect, useMemo, useState } from "react";
import { VAULT_TYPES, VaultEntry } from "@/lib/models";

async function copyTextSafe(text: string) {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }

  if (typeof document !== "undefined") {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "absolute";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
  }
}

type Draft = Partial<VaultEntry>;
type ProjectOption = {
  id: string;
  name: string;
};

function maskSecret(value: string) {
  const trimmed = value || "";
  if (trimmed.length <= 2) return "••••••";
  const prefix = trimmed.slice(0, Math.min(3, trimmed.length));
  return `${prefix}••••••••`;
}

export default function EntriesPage() {
  const [entries, setEntries] = useState<VaultEntry[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [q, setQ] = useState("");
  const [showValues, setShowValues] = useState(false);
  const [draft, setDraft] = useState<Draft>({ type: "API Key", tags: [], favorite: false, includeInEnv: true });

  const load = async () => {
    const res = await fetch("/api/entries");
    setEntries(await res.json());
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/entries");
      const data = await res.json();
      if (!cancelled) setEntries(data);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/projects?status=active");
      const data = (await res.json()) as ProjectOption[];
      if (!cancelled) setProjects(data);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const needle = q.toLowerCase();
    return entries.filter((e) =>
      [e.name, e.key, e.type, e.project || "", e.tags.join(" ")].join(" ").toLowerCase().includes(needle)
    );
  }, [entries, q]);

  const save = async () => {
    const method = draft.id ? "PUT" : "POST";
    const url = draft.id ? `/api/entries/${draft.id}` : "/api/entries";
    await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...draft, tags: (draft.tags || []).filter(Boolean) }),
    });
    setDraft({ type: "API Key", tags: [], favorite: false, includeInEnv: true });
    await load();
  };

  const onProjectChange = (value: string) => {
    const selected = projects.find((p) => p.name.toLowerCase() === value.trim().toLowerCase());
    setDraft({
      ...draft,
      project: value,
      projectId: selected?.id,
    });
  };

  const remove = async (id: string, name: string) => {
    const ok = window.confirm(`Delete entry "${name}"? This cannot be undone.`);
    if (!ok) return;
    await fetch(`/api/entries/${id}`, { method: "DELETE" });
    await load();
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
      <div className="rounded-xl border border-white/10 bg-white/5 p-4">
        <h2 className="text-xl font-semibold">{draft.id ? "Edit Entry" : "New Entry"}</h2>
        <div className="mt-4 space-y-3 text-sm">
          <input className="w-full rounded-lg bg-black/30 p-2" placeholder="Name" value={draft.name || ""} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          <input className="w-full rounded-lg bg-black/30 p-2 font-mono" placeholder="ENV KEY (e.g. OPENAI_API_KEY)" value={draft.key || ""} onChange={(e) => setDraft({ ...draft, key: e.target.value })} />
          <select className="w-full rounded-lg bg-black/30 p-2" value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value as VaultEntry["type"] })}>
            {VAULT_TYPES.map((type) => <option key={type}>{type}</option>)}
          </select>
          <textarea className="h-24 w-full rounded-lg bg-black/30 p-2 font-mono" placeholder="Value" value={draft.value || ""} onChange={(e) => setDraft({ ...draft, value: e.target.value })} />
          <input
            className="w-full rounded-lg bg-black/30 p-2"
            placeholder={projects.length ? "Project (search active projects)" : "Project"}
            value={draft.project || ""}
            list="active-projects"
            onChange={(e) => onProjectChange(e.target.value)}
          />
          <datalist id="active-projects">
            {projects.map((project) => (
              <option key={project.id} value={project.name} />
            ))}
          </datalist>
          <input className="w-full rounded-lg bg-black/30 p-2" placeholder="Tags comma separated" value={(draft.tags || []).join(", ")} onChange={(e) => setDraft({ ...draft, tags: e.target.value.split(",").map((t) => t.trim()) })} />
          <textarea className="h-20 w-full rounded-lg bg-black/30 p-2" placeholder="Description" value={draft.description || ""} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
          <label className="flex items-center gap-2"><input type="checkbox" checked={!!draft.favorite} onChange={(e) => setDraft({ ...draft, favorite: e.target.checked })} /> Favorite</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={draft.includeInEnv ?? true} onChange={(e) => setDraft({ ...draft, includeInEnv: e.target.checked })} /> Include in generated env</label>
          <button onClick={save} className="w-full rounded-lg bg-cyan-500/80 p-2 font-medium text-black hover:bg-cyan-400">Save Entry</button>
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex gap-2">
          <input className="w-full rounded-lg border border-white/10 bg-black/30 p-2" placeholder="Search name, key, tag, project, type..." value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="rounded bg-white/10 px-3 text-sm" onClick={() => setShowValues((s) => !s)}>{showValues ? "Mask" : "Reveal"}</button>
        </div>
        <div className="space-y-2">
          {filtered.map((e) => (
            <div key={e.id} className="rounded-xl border border-white/10 bg-white/5 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium">{e.name} {e.favorite ? "★" : ""}</p>
                  <p className="text-xs text-zinc-400 font-mono">{e.key || "NO_KEY"} • {e.type} • {e.project || "No project"}</p>
                  <p className="mt-2 text-xs text-zinc-500">{e.description}</p>
                  <p className="mt-2 rounded bg-black/30 px-2 py-1 font-mono text-xs">{showValues ? e.value : maskSecret(e.value)} <button className="ml-2 text-cyan-300" onClick={() => copyTextSafe(e.value)}>Copy</button></p>
                  <p className="mt-2 text-xs text-zinc-400">{e.tags.map((t) => `#${t}`).join(" ")} {e.includeInEnv ? "• env:on" : "• env:off"}</p>
                </div>
                <div className="space-y-2 text-xs">
                  <button className="block rounded bg-white/10 px-2 py-1" onClick={() => setDraft(e)}>Edit</button>
                  <button className="block rounded bg-rose-500/20 px-2 py-1 text-rose-200" onClick={() => remove(e.id, e.name)}>Delete</button>
                </div>
              </div>
            </div>
          ))}
          {filtered.length === 0 && <p className="text-sm text-zinc-500">No entries found.</p>}
        </div>
      </div>
    </div>
  );
}
