export function Card({
  title,
  children,
  aside,
}: {
  title: string;
  children: React.ReactNode;
  aside?: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-3 flex items-center justify-between gap-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-1.5 sm:flex-row sm:gap-4">
      <dt className="w-36 shrink-0 text-sm text-zinc-500">{label}</dt>
      <dd className="min-w-0 break-all font-mono text-sm">{children}</dd>
    </div>
  );
}

export function Ext({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-blue-600 underline-offset-2 hover:underline dark:text-blue-400"
    >
      {children}
    </a>
  );
}

export function Check({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`rounded px-1.5 py-0.5 font-sans text-xs ${ok ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" : "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300"}`}
    >
      {ok ? "✓" : "✗"} {label}
    </span>
  );
}
