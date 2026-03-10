import { dashboardSummary } from "@/lib/vault";

export default async function Dashboard() {
  const data = await dashboardSummary();
  const cards = [
    { label: "Entries", value: data.counts.entries },
    { label: "Projects", value: data.counts.projects },
    { label: "Files", value: data.counts.files },
    { label: "Favorites", value: data.counts.favorites },
  ];

  return (
    <div className="space-y-8">
      <section>
        <h2 className="text-3xl font-semibold">Command Center</h2>
        <p className="mt-1 text-zinc-400">A local-first vault for secrets, config, and credentials.</p>
      </section>

      <section className="grid gap-4 md:grid-cols-4">
        {cards.map((card) => (
          <div key={card.label} className="rounded-xl border border-white/10 bg-white/5 p-4">
            <p className="text-xs uppercase tracking-widest text-zinc-400">{card.label}</p>
            <p className="mt-2 text-3xl font-semibold text-cyan-200">{card.value}</p>
          </div>
        ))}
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <h3 className="font-medium">Category Overview</h3>
          <div className="mt-3 space-y-2">
            {Object.keys(data.categories).length === 0 ? (
              <p className="text-sm text-zinc-500">No entries yet. Add your first key in Entries.</p>
            ) : (
              Object.entries(data.categories).map(([k, v]) => (
                <div key={k} className="flex items-center justify-between rounded-md bg-black/20 px-3 py-2 text-sm">
                  <span>{k}</span>
                  <span className="text-cyan-200">{v}</span>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <h3 className="font-medium">Recent Activity</h3>
          <div className="mt-3 space-y-2">
            {data.recent.length === 0 ? (
              <p className="text-sm text-zinc-500">No activity yet.</p>
            ) : (
              data.recent.map((r) => (
                <div key={r.id} className="rounded-md bg-black/20 px-3 py-2 text-sm">
                  <p className="text-zinc-200">{r.action}: {r.target}</p>
                  <p className="text-xs text-zinc-500">{new Date(r.at).toLocaleString()}</p>
                </div>
              ))
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
