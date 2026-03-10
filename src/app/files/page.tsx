"use client";

import { useEffect, useState } from "react";
import { VaultFile } from "@/lib/models";

export default function FilesPage() {
  const [files, setFiles] = useState<VaultFile[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [project, setProject] = useState("");
  const [tags, setTags] = useState("");

  const load = async () => {
    const res = await fetch("/api/files");
    setFiles(await res.json());
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/files");
      const data = await res.json();
      if (!cancelled) setFiles(data);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const upload = async () => {
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    form.append("project", project);
    form.append("tags", tags);
    await fetch("/api/files", { method: "POST", body: form });
    setFile(null);
    setProject("");
    setTags("");
    await load();
  };

  const remove = async (id: string, name: string) => {
    const ok = window.confirm(`Delete file "${name}"? This cannot be undone.`);
    if (!ok) return;
    await fetch(`/api/files/${id}`, { method: "DELETE" });
    await load();
  };

  const rename = async (id: string, originalName: string) => {
    const next = prompt("Rename file", originalName);
    if (!next) return;
    await fetch(`/api/files/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ originalName: next }) });
    await load();
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-white/10 bg-white/5 p-4">
        <h2 className="text-lg font-semibold">Upload credential/config file</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-4">
          <input type="file" className="rounded bg-black/30 p-2" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          <input className="rounded bg-black/30 p-2" placeholder="Project" value={project} onChange={(e) => setProject(e.target.value)} />
          <input className="rounded bg-black/30 p-2" placeholder="Tags csv" value={tags} onChange={(e) => setTags(e.target.value)} />
          <button onClick={upload} className="rounded bg-cyan-500/80 p-2 font-medium text-black">Upload</button>
        </div>
      </div>

      <div className="space-y-2">
        {files.map((f) => (
          <div key={f.id} className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 p-4">
            <div>
              <p className="font-medium">{f.originalName}</p>
              <p className="text-xs text-zinc-400">{f.mimeType} • {(f.size / 1024).toFixed(1)}KB • {f.project || "No project"}</p>
            </div>
            <div className="space-x-2 text-xs">
              <button onClick={() => rename(f.id, f.originalName)} className="rounded bg-white/10 px-2 py-1">Rename</button>
              <button onClick={() => remove(f.id, f.originalName)} className="rounded bg-rose-500/20 px-2 py-1 text-rose-200">Delete</button>
            </div>
          </div>
        ))}
        {files.length === 0 && <p className="text-sm text-zinc-500">No files uploaded yet.</p>}
      </div>
    </div>
  );
}
