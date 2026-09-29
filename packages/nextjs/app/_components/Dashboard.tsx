"use client";

import type { ActionResult, PassportView } from "@sh/agent";
import { useCallback, useEffect, useState } from "react";
import type { ApiError } from "~/lib/api";
import { Card, Check, Ext, Row } from "./ui";

/** Server errors, plus NETWORK when the dev server itself cannot be reached. */
type ApiFailure = Omit<ApiError["error"], "code"> & { code: ApiError["error"]["code"] | "NETWORK" };

type Loaded = { passport: PassportView; isLocalAgent: boolean };

async function request<T>(url: string, init?: RequestInit): Promise<{ body: T } | { error: ApiFailure }> {
  try {
    const response = await fetch(url, { cache: "no-store", ...init });
    const body = await response.json();
    return response.ok ? { body: body as T } : { error: (body as ApiError).error };
  } catch (error) {
    return { error: { code: "NETWORK", message: String(error), hint: "Is `npm run dev` still running?" } };
  }
}

function consensusTime(timestamp: string): string {
  return new Date(Number(timestamp.split(".")[0]) * 1000).toLocaleString();
}

const ACTION_STYLE: Record<string, string> = {
  ALERT_UP: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  ALERT_DOWN: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
};

export function Dashboard() {
  const [account, setAccount] = useState("");
  const [query, setQuery] = useState("");
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<ApiFailure | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async (accountId: string) => {
    setLoading(true);
    const result = await request<Loaded>(
      `/api/passport${accountId ? `?account=${encodeURIComponent(accountId)}` : ""}`,
    );
    if ("error" in result) {
      setError(result.error);
      setData(null);
    } else {
      setError(null);
      setData(result.body);
    }
    setLoading(false);
    return result;
  }, []);

  useEffect(() => {
    void load(query);
  }, [load, query]);

  async function act() {
    setActing(true);
    setNotice(null);
    const result = await request<ActionResult>("/api/agent/act", { method: "POST" });
    if ("error" in result) {
      setError(result.error);
      setActing(false);
      return;
    }
    const { decision, sequenceNumber, verification } = result.body;
    setNotice(
      verification
        ? `${decision.action} reached consensus as message #${sequenceNumber}.`
        : `${decision.action} was submitted as message #${sequenceNumber}; waiting for the Mirror Node to index it…`,
    );
    // Only the Mirror Node's copy is shown, so poll until it has indexed the message.
    for (let attempt = 0; attempt < 10; attempt++) {
      const reloaded = await load(query);
      const seen =
        !("error" in reloaded) &&
        reloaded.body.passport.decisions.some(d => d.verification.sequenceNumber === sequenceNumber);
      if (seen) break;
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
    setActing(false);
  }

  const passport = data?.passport;
  const latest = passport?.decisions[0];

  return (
    <div className="space-y-6">
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={event => {
          event.preventDefault();
          setQuery(account.trim());
        }}
      >
        <input
          value={account}
          onChange={event => setAccount(event.target.value)}
          placeholder="Inspect any HCS-10 agent: 0.0.x (empty = your agent)"
          className="flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 font-mono text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
        <button className="rounded-lg border border-zinc-300 px-4 py-2 text-sm dark:border-zinc-700" type="submit">
          Load passport
        </button>
      </form>

      {error && (
        <div
          role="alert"
          className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm dark:border-red-900 dark:bg-red-950/40"
        >
          <p className="font-semibold">
            {error.code}: {error.message}
          </p>
          <p className="mt-1 text-zinc-700 dark:text-zinc-300">→ {error.hint}</p>
        </div>
      )}

      {loading && !passport && <p className="text-sm text-zinc-500">Reading from the Mirror Node…</p>}

      {passport && (
        <>
          <Card title="Identity (HCS-11)" aside={<span className="text-xs text-zinc-500">{passport.network}</span>}>
            <dl>
              <Row label="Name">{passport.profile?.displayName ?? "—"}</Row>
              <Row label="Account">
                <Ext href={passport.accountUrl}>{passport.accountId}</Ext> · {passport.balanceHbar.toFixed(2)} HBAR
              </Row>
              {passport.profile ? (
                <>
                  <Row label="Profile">
                    hcs://1/{passport.profile.topicId} <Check ok label="hash verified" />
                  </Row>
                  <Row label="Model">{passport.profile.model ?? "—"}</Row>
                  <Row label="Capabilities">{passport.profile.capabilities.join(", ") || "—"}</Row>
                </>
              ) : (
                <Row label="Profile">{passport.profileError}</Row>
              )}
            </dl>
          </Card>

          <Card title="Communication (HCS-10)">
            <dl>
              {passport.inbound && (
                <Row label="Inbound topic">
                  <Ext href={passport.inbound.hashscanUrl}>{passport.inbound.topicId}</Ext>{" "}
                  <Check ok={passport.inbound.verified} label={`memo ${passport.inbound.memo || "missing"}`} />
                </Row>
              )}
              {passport.outbound && (
                <Row label="Outbound topic">
                  <Ext href={passport.outbound.hashscanUrl}>{passport.outbound.topicId}</Ext>{" "}
                  <Check ok={passport.outbound.verified} label={`memo ${passport.outbound.memo || "missing"}`} />
                </Row>
              )}
              <Row label="Registry">
                {passport.registration ? (
                  <>
                    <Ext href={passport.registration.hashscanUrl}>
                      {passport.registration.registryTopicId} #{passport.registration.sequenceNumber}
                    </Ext>{" "}
                    · {consensusTime(passport.registration.consensusTimestamp)}
                  </>
                ) : (
                  "no register entry in the configured registry"
                )}
              </Row>
              {passport.connections.map(c => (
                <Row key={c.connectionTopicId} label="Connection">
                  <Ext href={c.hashscanUrl}>{c.connectionTopicId}</Ext> ↔ {c.peerAccountId ?? "unknown peer"} · opened{" "}
                  {consensusTime(c.opened.consensusTimestamp)}
                </Row>
              ))}
            </dl>
          </Card>

          <Card
            title={`Decision log (${passport.decisions.length})`}
            aside={
              data.isLocalAgent && (
                <button
                  onClick={act}
                  disabled={acting}
                  className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
                >
                  {acting ? "Publishing…" : "Run agent step"}
                </button>
              )
            }
          >
            {notice && <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-400">{notice}</p>}
            {passport.decisions.length === 0 ? (
              <p className="text-sm text-zinc-500">No decisions yet.</p>
            ) : (
              <ol className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {passport.decisions.map(({ decision, verification }) => (
                  <li key={verification.consensusTimestamp} className="py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded px-2 py-0.5 font-mono text-xs ${ACTION_STYLE[decision.action] ?? "bg-zinc-100 dark:bg-zinc-800"}`}
                      >
                        {decision.action}
                      </span>
                      <span className="text-sm">{decision.reason}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-4 font-mono text-xs text-zinc-500">
                      <span>
                        {decision.skill} · consensus {verification.consensusTimestamp}
                      </span>
                      <Ext href={verification.hashscanUrl}>Hashscan</Ext>
                      <Ext href={verification.mirrorUrl}>Mirror Node #{verification.sequenceNumber}</Ext>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Card>

          {latest && (
            <Card title="Verify it yourself">
              <p className="mb-2 text-sm text-zinc-600 dark:text-zinc-400">
                The latest decision, straight from a public Mirror Node. The message is base64; its{" "}
                <code>operator_id</code> must end in <code>@{passport.accountId}</code>.
              </p>
              <pre className="overflow-x-auto rounded-lg bg-zinc-100 p-3 text-xs dark:bg-zinc-800">
                curl -s {latest.verification.mirrorUrl}
              </pre>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
