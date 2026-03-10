"use client";

import { useEffect, useState } from "react";

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

type EnvStatus = {
  vaultPath: string;
  envPath: string;
  exportPath: string;
  envCompatible: number;
  shellLine: string;
  generatedAt: string | null;
  duplicateKeys: string[];
  invalidNames: string[];
  checksum: string | null;
  envExists: boolean;
  exportsExists: boolean;
  permissions: { vault: string | null; env: string | null; exports: string | null };
  permissionWarnings: string[];
};

export default function EnvironmentPage() {
  const [status, setStatus] = useState<EnvStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const res = await fetch("/api/environment");
    setStatus(await res.json());
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/environment");
      const data = await res.json();
      if (!cancelled) setStatus(data);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const generate = async () => {
    setBusy(true);
    await fetch("/api/environment/generate", { method: "POST" });
    await load();
    setBusy(false);
  };

  if (!status) return <p className="text-sm text-zinc-400">Loading environment status…</p>;

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-semibold">Environment</h2>

      <div className="grid gap-4 md:grid-cols-3">
        <Card label="Env-compatible entries" value={String(status.envCompatible)} />
        <Card label=".env.generated" value={status.envExists ? "Present" : "Missing"} />
        <Card label=".env.exports.sh" value={status.exportsExists ? "Present" : "Missing"} />
      </div>

      <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-2 text-sm">
        <p><span className="text-zinc-400">Vault path:</span> <code>{status.vaultPath}</code></p>
        <p><span className="text-zinc-400">Generated env:</span> <code>{status.envPath}</code></p>
        <p><span className="text-zinc-400">Exports file:</span> <code>{status.exportPath}</code></p>
        <p><span className="text-zinc-400">Last generation:</span> {status.generatedAt ? new Date(status.generatedAt).toLocaleString() : "Never"}</p>
        <p><span className="text-zinc-400">Checksum:</span> <code>{status.checksum || "n/a"}</code></p>
        <p><span className="text-zinc-400">Permissions:</span> vault=<code>{status.permissions.vault || "n/a"}</code> env=<code>{status.permissions.env || "n/a"}</code> exports=<code>{status.permissions.exports || "n/a"}</code></p>
      </div>

      <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3">
        <h3 className="font-medium">Shell Integration (manual, safe)</h3>
        <p className="text-sm text-zinc-400">Add this line to your <code>~/.zshrc</code> or <code>~/.bashrc</code> manually:</p>
        <pre className="overflow-x-auto rounded bg-black/40 p-3 text-xs text-cyan-200">{status.shellLine}</pre>
        <button onClick={() => copyTextSafe(status.shellLine)} className="rounded bg-white/10 px-3 py-2 text-sm">Copy shell line</button>
      </div>

      <div className="flex items-center gap-3">
        <button onClick={generate} disabled={busy} className="rounded-lg bg-cyan-500/80 px-4 py-2 font-medium text-black disabled:opacity-50">
          {busy ? "Generating…" : "Generate Env Files"}
        </button>
        <p className="text-sm text-zinc-400">This regenerates files from current vault data (not append mode).</p>
      </div>

      {(status.duplicateKeys.length > 0 || status.invalidNames.length > 0 || status.permissionWarnings.length > 0) && (
        <div className="rounded-xl border border-amber-400/20 bg-amber-500/10 p-4 text-sm space-y-2">
          <h3 className="font-medium text-amber-200">Validation warnings</h3>
          {status.duplicateKeys.length > 0 && <p>Duplicate keys: {status.duplicateKeys.join(", ")}</p>}
          {status.invalidNames.length > 0 && <p>Invalid key names from entries: {status.invalidNames.join(", ")}</p>}
          {status.permissionWarnings.length > 0 && status.permissionWarnings.map((w) => <p key={w}>{w}</p>)}
        </div>
      )}
    </div>
  );
}

function Card({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <p className="text-xs uppercase tracking-widest text-zinc-400">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-cyan-200">{value}</p>
    </div>
  );
}
