import { Dashboard } from "./_components/Dashboard";

export default function Home() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Agent Passport</h1>
        <p className="mt-1 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
          Every field below is read from the Hedera Mirror Node, not from this app: the HCS-11 profile, the HCS-10
          topics, the registry entry and each decision the agent has published. Follow any link to check it yourself.
        </p>
      </header>
      <Dashboard />
    </main>
  );
}
