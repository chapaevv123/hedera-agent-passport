import { performAction, type ActionResult } from "./act";
import type { NetworkConfig } from "./config";
import { classifyHederaError } from "./errors";
import { accountOfOperatorId, hcs10Messages, type Hcs10Message } from "./hcs10";
import type { MirrorClient } from "./mirror";
import { alignClockWithNetwork, identityClient } from "./passport";
import type { AgentSkill } from "./skills/types";
import type { ConnectedState } from "./state";

export interface PendingRequest {
  sequenceNumber: number;
  requesterAccountId: string;
}

/**
 * `connection_request`s on the agent's inbound topic that it has not yet
 * answered. "Answered" is read from the agent's outbound topic, where every
 * accepted request is recorded with its `connection_request_id`, so a
 * restarted listener picks up exactly where the chain says it left off.
 * A request whose `operator_id` names a different account than the one that
 * paid for it is ignored: anyone can write to a public inbound topic.
 */
export function pendingRequests(
  inbound: Hcs10Message[],
  outbound: Hcs10Message[],
  agentAccountId: string,
): PendingRequest[] {
  const answered = new Set(
    outbound
      .filter(m => m.envelope.op === "connection_created" && m.payerAccountId === agentAccountId)
      .map(m => m.envelope.connection_request_id),
  );
  return inbound.flatMap(m => {
    if (m.envelope.op !== "connection_request" || answered.has(m.sequenceNumber)) return [];
    const requester = accountOfOperatorId(m.envelope.operator_id);
    if (!requester || requester !== m.payerAccountId || requester === agentAccountId) return [];
    return [{ sequenceNumber: m.sequenceNumber, requesterAccountId: requester }];
  });
}

/** Connection topics the agent has recorded on its outbound topic. */
export function connectionTopics(outbound: Hcs10Message[], agentAccountId: string): string[] {
  const topics = outbound
    .filter(m => m.envelope.op === "connection_created" && m.payerAccountId === agentAccountId)
    .map(m => m.envelope.connection_topic_id)
    .filter((t): t is string => Boolean(t));
  return [...new Set(topics)];
}

/** A connection is waiting for the agent when its newest message is a peer's `message`. */
export function awaitsReply(newest: Hcs10Message | undefined, agentAccountId: string): boolean {
  return newest?.envelope.op === "message" && newest.payerAccountId !== agentAccountId;
}

export type ListenEvent =
  | { kind: "accepted"; requesterAccountId: string; requestSequence: number; connectionTopicId: string }
  | { kind: "replied"; connectionTopicId: string; to: number; result: ActionResult };

/**
 * One polling pass: accept every pending connection request, then answer
 * every connection whose newest message came from the peer by running
 * `skill` and publishing the decision there. `seen` guards against acting
 * twice on the same item while the Mirror Node has not yet indexed our reply.
 */
export async function listenOnce(
  cfg: NetworkConfig,
  state: ConnectedState,
  skill: AgentSkill,
  mirror: MirrorClient,
  seen: Set<string>,
  onEvent: (event: ListenEvent) => void,
): Promise<void> {
  const { agent } = state;
  const [inbound, outbound] = await Promise.all([
    mirror.listTopicMessages(agent.inboundTopicId, { limit: 100 }).then(hcs10Messages),
    mirror.listTopicMessages(agent.outboundTopicId, { limit: 100 }).then(hcs10Messages),
  ]);
  await alignClockWithNetwork(mirror);

  const topics = connectionTopics(outbound, agent.accountId);
  for (const request of pendingRequests(inbound, outbound, agent.accountId)) {
    const key = `request:${request.sequenceNumber}`;
    if (seen.has(key)) continue;
    seen.add(key);
    let connectionTopicId: string;
    try {
      ({ connectionTopicId } = await identityClient(cfg, agent).handleConnectionRequest(
        agent.inboundTopicId,
        request.requesterAccountId,
        request.sequenceNumber,
      ));
    } catch (error) {
      throw classifyHederaError(error, `accept connection request #${request.sequenceNumber}`);
    }
    topics.push(connectionTopicId);
    onEvent({
      kind: "accepted",
      requesterAccountId: request.requesterAccountId,
      requestSequence: request.sequenceNumber,
      connectionTopicId,
    });
  }

  for (const connectionTopicId of topics) {
    const [newest] = hcs10Messages(await mirror.listTopicMessages(connectionTopicId, { limit: 1 }));
    if (!newest || !awaitsReply(newest, agent.accountId)) continue;
    const key = `reply:${connectionTopicId}#${newest.sequenceNumber}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const result = await performAction(cfg, state, skill, { connectionTopicId, mirror });
    onEvent({ kind: "replied", connectionTopicId, to: newest.sequenceNumber, result });
  }
}
