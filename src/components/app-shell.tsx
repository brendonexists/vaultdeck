"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const nav = [
  { href: "/", label: "Dashboard" },
  { href: "/entries", label: "Entries" },
  { href: "/projects", label: "Projects" },
  { href: "/files", label: "Files" },
  { href: "/environment", label: "Environment" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-[#07090f] text-zinc-100">
      <div className="mx-auto grid min-h-screen max-w-7xl grid-cols-1 gap-4 p-4 lg:grid-cols-[260px_1fr]">
        <aside className="rounded-2xl border border-white/10 bg-gradient-to-b from-[#101521] to-[#0b0f18] p-4 shadow-2xl shadow-black/30">
          <div className="mb-8 rounded-xl border border-cyan-400/20 bg-cyan-500/5 p-4">
            <p className="text-xs uppercase tracking-[0.3em] text-cyan-300/80">VaultDeck</p>
            <h1 className="mt-2 text-2xl font-semibold">Local Control Panel</h1>
            <p className="mt-1 text-sm text-zinc-400">~/.vaultdeck source of truth</p>
          </div>
          <nav className="space-y-2">
            {nav.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`block rounded-lg px-3 py-2 text-sm transition ${
                    active
                      ? "bg-cyan-400/20 text-cyan-100"
                      : "text-zinc-300 hover:bg-white/5 hover:text-white"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </aside>
        <main className="rounded-2xl border border-white/10 bg-[#0d1320]/90 p-6 shadow-2xl shadow-black/30">{children}</main>
      </div>
    </div>
  );
}
