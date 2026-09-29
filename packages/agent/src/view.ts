import { AIAgentCapability } from "@hashgraphonline/standards-sdk";
import type { Network } from "./config";
import { parseDecision, type Decision } from "./decision";
import { decodeHcs1 } from "./hcs1";
import { accountOfOperatorId, hcs10Messages, parseTopicMemo, type Hcs10Message } from "./hcs10";
import type { MirrorClient } from "./mirror";
import { hashscanAccountUrl, hashscanTopicUrl, verificationFor, type Verification } from "./verify";

export interface TopicCheck {
  topicId: string;
  memo: string;
  /** The memo on the Mirror Node declares the expected HCS-10 role (and owner, for inbound). */
  verified: boolean;
  hashscanUrl: string;
}

export interface ProfileView {
  topicId: string;
  displayName: string;
  bio?: string;
  model?: string;
  /** HCS-11 capability names, e.g. "MARKET_INTELLIGENCE". */
  capabilities: string[];
  inboundTopicId: string;
  outboundTopicId: string;
}

export interface ConnectionView {
  connectionTopicId: string;
  peerAccountId?: string;
  opened: Verification;
  hashscanUrl: string;
}

export interface DecisionView {
  decision: Decision;
  verification: Verification;
}

export interface PassportView {
  network: Network;
  accountId: string;
  accountUrl: string;
  balanceHbar: number;
  profile: ProfileView | null;
  /** Why the profile could not be resolved, when it could not. */
  profileError?: string;
  inbound?: TopicCheck;
  outbound?: TopicCheck;
  registration: (Verification & { registryTopicId: string }) | null;
  connections: ConnectionView[];
  /** Newest first, across all of the agent's connections. */
  decisions: DecisionView[];
}

const PROFILE_MEMO = /^hcs-11:hcs:\/\/1\/(0\.0\.\d+)$/;

async function checkTopic(
  mirror: MirrorClient,
  network: Network,
  topicId: string,
  role: "inbound" | "outbound",
  owner: string,
): Promise<TopicCheck> {
  const topic = await mirror.getTopic(topicId);
  const memo = topic?.memo ?? "";
  const parsed = parseTopicMemo(memo);
  const verified = parsed?.role === role && (role !== "inbound" || parsed.ref === owner);
  return { topicId, memo, verified, hashscanUrl: hashscanTopicUrl(network, topicId) };
}

/**
 * Resolves the HCS-11 profile straight from the Mirror Node: the account memo
 * names an HCS-1 topic, whose chunks are reassembled and checked against the
 * SHA-256 in the topic memo. No inscription service or CDN is trusted.
 */
async function resolveProfile(
  mirror: MirrorClient,
  memo: string,
): Promise<{ profile: ProfileView | null; error?: string }> {
  const topicId = PROFILE_MEMO.exec(memo)?.[1];
  if (!topicId) {
    return { profile: null, error: `Account memo "${memo}" does not reference an HCS-11 profile.` };
  }
  const topic = await mirror.getTopic(topicId);
  if (!topic) return { profile: null, error: `Profile topic ${topicId} is not on the Mirror Node yet.` };

  let raw: Record<string, unknown>;
  try {
    const file = decodeHcs1(topic.memo, await mirror.listTopicMessages(topicId, { limit: 100, order: "asc" }));
    raw = JSON.parse(file.content.toString("utf8")) as Record<string, unknown>;
  } catch (error) {
    return { profile: null, error: `Profile ${topicId} is not a valid HCS-1 file: ${(error as Error).message}` };
  }
  const aiAgent = raw.aiAgent as { capabilities?: number[]; model?: string } | undefined;
  return {
    profile: {
      topicId,
      displayName: String(raw.display_name ?? ""),
      bio: raw.bio as string | undefined,
      model: aiAgent?.model,
      capabilities: (aiAgent?.capabilities ?? []).map(c => AIAgentCapability[c] ?? `UNKNOWN_${c}`),
      inboundTopicId: String(raw.inboundTopicId ?? ""),
      outboundTopicId: String(raw.outboundTopicId ?? ""),
    },
  };
}

function decisionsFrom(
  network: Network,
  mirrorNodeUrl: string,
  agentAccountId: string,
  messages: Hcs10Message[],
): DecisionView[] {
  return messages.flatMap(message => {
    if (message.envelope.op !== "message" || message.payerAccountId !== agentAccountId) return [];
    const decision = parseDecision(message.envelope.data);
    return decision ? [{ decision, verification: verificationFor(network, mirrorNodeUrl, message) }] : [];
  });
}

/**
 * Builds an agent's passport purely from public network state: account memo →
 * HCS-11 profile → HCS-10 topics (memos checked) → registry entry →
 * connections recorded on the outbound topic → decisions on each connection.
 * Works for any HCS-10 agent, not only ones created by this template.
 */
export async function readPassport(
  mirror: MirrorClient,
  network: Network,
  accountId: string,
  registryTopicId?: string,
): Promise<PassportView | null> {
  const account = await mirror.getAccount(accountId);
  if (!account) return null;

  const view: PassportView = {
    network,
    accountId,
    accountUrl: hashscanAccountUrl(network, accountId),
    balanceHbar: account.balanceTinybar / 1e8,
    profile: null,
    registration: null,
    connections: [],
    decisions: [],
  };

  const { profile, error } = await resolveProfile(mirror, account.memo);
  view.profile = profile;
  if (error) view.profileError = error;
  if (!profile) return view;

  [view.inbound, view.outbound] = await Promise.all([
    checkTopic(mirror, network, profile.inboundTopicId, "inbound", accountId),
    checkTopic(mirror, network, profile.outboundTopicId, "outbound", accountId),
  ]);

  if (registryTopicId) {
    const entries = hcs10Messages(await mirror.listTopicMessages(registryTopicId, { limit: 100 }));
    const entry = entries.find(m => m.envelope.op === "register" && m.envelope.account_id === accountId);
    if (entry) view.registration = { ...verificationFor(network, mirror.baseUrl, entry), registryTopicId };
  }

  // Both sides of a handshake record `connection_created` on their own
  // outbound topic, which only the owner's key can write to — so this list is
  // the agent's own statement of who it talks to, whichever side initiated.
  const outbound = hcs10Messages(await mirror.listTopicMessages(profile.outboundTopicId, { limit: 100 }));
  const seen = new Set<string>();
  view.connections = outbound.flatMap(m => {
    const topicId = m.envelope.connection_topic_id;
    if (m.envelope.op !== "connection_created" || !topicId || m.payerAccountId !== accountId || seen.has(topicId))
      return [];
    seen.add(topicId);
    return [
      {
        connectionTopicId: topicId,
        peerAccountId: accountOfOperatorId(m.envelope.operator_id),
        opened: verificationFor(network, mirror.baseUrl, m),
        hashscanUrl: hashscanTopicUrl(network, topicId),
      },
    ];
  });

  const perConnection = await Promise.all(
    view.connections.map(async c =>
      decisionsFrom(
        network,
        mirror.baseUrl,
        accountId,
        hcs10Messages(await mirror.listTopicMessages(c.connectionTopicId)),
      ),
    ),
  );
  view.decisions = perConnection
    .flat()
    .sort((a, b) => b.verification.consensusTimestamp.localeCompare(a.verification.consensusTimestamp));

  return view;
}
