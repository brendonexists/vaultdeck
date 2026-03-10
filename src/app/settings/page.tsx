"use client";

import { useEffect, useState } from "react";

type UiSettings = {
  host: string;
  port: number;
  source: "defaults" | "project-file";
  settingsFile: string;
};

type UiRuntime = {
  pid: number | null;
  running: boolean;
  responsive: boolean;
  host: string;
  port: number;
  startedAt: string | null;
  url: string;
};

type Payload = { settings: UiSettings; runtime: UiRuntime };

export default function SettingsPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [host, setHost] = useState("");
  const [port, setPort] = useState("3000");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const load = async () => {
    const res = await fetch("/api/settings/ui", { cache: "no-store" });
    const body = (await res.json()) as Payload;
    setData(body);
    setHost(body.settings.host);
    setPort(String(body.settings.port));
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/settings/ui", { cache: "no-store" });
      const body = (await res.json()) as Payload;
      if (!cancelled) {
        setData(body);
        setHost(body.settings.host);
        setPort(String(body.settings.port));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const save = async () => {
    setBusy(true);
    setMessage("");
    const res = await fetch("/api/settings/ui", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ host, port: Number(port) }),
    });
    const body = (await res.json()) as Payload;
    setData(body);
    setHost(body.settings.host);
    setPort(String(body.settings.port));
    setBusy(false);
    setMessage("Saved. Restart UI to apply changes.");
  };

  const control = async (action: "start" | "stop" | "restart") => {
    setBusy(true);
    setMessage("");
    await fetch("/api/settings/ui/control", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action }),
    });
    if (action === "stop" || action === "restart") {
      setMessage("Command sent. UI may disconnect for a moment.");
      setBusy(false);
      return;
    }
    await load();
    setBusy(false);
    setMessage("Command sent.");
  };

  if (!data) return <p className="text-sm text-zinc-400">Loading settings…</p>;

  const healthLabel = !data.runtime.running
    ? "Stopped"
    : data.runtime.responsive
      ? "Healthy"
      : "Running (not responding yet)";

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-semibold">Settings</h2>

      <div className="grid gap-4 md:grid-cols-3">
        <Card label="UI Health" value={healthLabel} accent={data.runtime.responsive ? "text-emerald-200" : "text-amber-200"} />
        <Card label="Host" value={data.runtime.host} />
        <Card label="Port" value={String(data.runtime.port)} />
      </div>

      <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-2 text-sm">
        <p><span className="text-zinc-400">URL:</span> <code>{data.runtime.url}</code></p>
        <p><span className="text-zinc-400">PID:</span> <code>{data.runtime.pid ?? "n/a"}</code></p>
        <p><span className="text-zinc-400">Started:</span> {data.runtime.startedAt ? new Date(data.runtime.startedAt).toLocaleString() : "n/a"}</p>
      </div>

      <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3">
        <h3 className="font-medium">Server Controls</h3>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => control("start")} disabled={busy} className="rounded bg-emerald-500/20 px-3 py-2 text-sm text-emerald-100 disabled:opacity-50">Start</button>
          <button onClick={() => control("stop")} disabled={busy} className="rounded bg-rose-500/20 px-3 py-2 text-sm text-rose-100 disabled:opacity-50">Stop</button>
          <button onClick={() => control("restart")} disabled={busy} className="rounded bg-cyan-500/20 px-3 py-2 text-sm text-cyan-100 disabled:opacity-50">Restart</button>
          <button onClick={load} disabled={busy} className="rounded bg-white/10 px-3 py-2 text-sm disabled:opacity-50">Refresh Health</button>
        </div>
      </div>

      <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3">
        <h3 className="font-medium">Runtime Defaults</h3>
        <p className="text-sm text-zinc-400">
          Saved in <code>{data.settings.settingsFile}</code>. Precedence: <code>VAULTDECK_HOST</code>/<code>VAULTDECK_PORT</code> env vars override file values.
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1 block text-zinc-300">Host</span>
            <input value={host} onChange={(e) => setHost(e.target.value)} className="w-full rounded border border-white/15 bg-black/30 px-3 py-2" placeholder="127.0.0.1" />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-zinc-300">Port</span>
            <input value={port} onChange={(e) => setPort(e.target.value)} className="w-full rounded border border-white/15 bg-black/30 px-3 py-2" inputMode="numeric" />
          </label>
        </div>
        <button onClick={save} disabled={busy} className="rounded-lg bg-cyan-500/80 px-4 py-2 font-medium text-black disabled:opacity-50">
          Save Settings
        </button>
      </div>

      {message && <p className="text-sm text-zinc-300">{message}</p>}
    </div>
  );
}

function Card({ label, value, accent = "text-cyan-200" }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <p className="text-xs uppercase tracking-widest text-zinc-400">{label}</p>
      <p className={`mt-2 text-2xl font-semibold ${accent}`}>{value}</p>
    </div>
  );
}
