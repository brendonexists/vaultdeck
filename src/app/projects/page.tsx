"use client";

import { useEffect, useState } from "react";
import { VaultProject } from "@/lib/models";

export default function ProjectsPage() {
  const [projects, setProjects] = useState<VaultProject[]>([]);
  const [draft, setDraft] = useState<Partial<VaultProject>>({ color: "#7c3aed", icon: "◈" });

  const load = async () => {
    const res = await fetch("/api/projects");
    setProjects(await res.json());
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/projects");
      const data = await res.json();
      if (!cancelled) setProjects(data);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const save = async () => {
    const method = draft.id ? "PUT" : "POST";
    const url = draft.id ? `/api/projects/${draft.id}` : "/api/projects";
    await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft) });
    setDraft({ color: "#7c3aed", icon: "◈" });
    await load();
  };

  const remove = async (id: string, name: string) => {
    const ok = window.confirm(`Delete project "${name}"? This cannot be undone.`);
    if (!ok) return;
    await fetch(`/api/projects/${id}`, { method: "DELETE" });
    await load();
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-4">
        <input className="rounded-lg bg-black/30 p-2" placeholder="Project name" value={draft.name || ""} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        <input className="rounded-lg bg-black/30 p-2" placeholder="Description" value={draft.description || ""} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
        <input className="rounded-lg bg-black/30 p-2" placeholder="#7c3aed" value={draft.color || ""} onChange={(e) => setDraft({ ...draft, color: e.target.value })} />
        <button className="rounded-lg bg-cyan-500/80 p-2 font-medium text-black" onClick={save}>Save Project</button>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {projects.map((p) => (
          <div key={p.id} className="rounded-xl border border-white/10 bg-white/5 p-4">
            <div className="flex items-center justify-between">
              <h3 className="font-medium" style={{ color: p.color }}>{p.icon} {p.name}</h3>
              <div className="space-x-2 text-xs">
                <button onClick={() => setDraft(p)} className="rounded bg-white/10 px-2 py-1">Edit</button>
                <button onClick={() => remove(p.id, p.name)} className="rounded bg-rose-500/20 px-2 py-1 text-rose-200">Delete</button>
              </div>
            </div>
            <p className="mt-2 text-sm text-zinc-400">{p.description}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
