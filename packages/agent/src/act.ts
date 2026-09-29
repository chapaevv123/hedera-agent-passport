import type { NetworkConfig } from "./config";
import { DECISION_SCHEMA, encodeDecision, parseDecision, type Decision } from "./decision";
import { classifyHederaError, PassportError } from "./errors";
import { hcs10Messages } from "./hcs10";
import { MirrorClient } from "./mirror";
import { alignClockWithNetwork, identityClient } from "./passport";
import type { AgentSkill } from "./skills/types";
import type { ConnectedState } from "./state";
import { verificationFor, type Verification } from "./verify";

export interface ActionResult {
  decision: Decision;
  topicId: string;
  sequenceNumber: number;
  /** null when the Mirror Node has not caught up yet; the message is still final. */
  verification: Verification | null;
}

const PAGE_SIZE = 100;
/** How far back to look for the previous decision before treating the skill as new. */
const MAX_SCAN = 1000;

/**
 * Latest well-formed decision by `skill` from `agentAccountId` on the
 * connection topic, paging backwards so chatter from the peer or other skills
 * cannot push it out of view.
 */
async function latestDecision(
  mirror: MirrorClient,
  connectionTopicId: string,
  agentAccountId: string,
  skill: string,
): Promise<Decision | null> {
  let before: number | undefined;
  for (let scanned = 0; scanned < MAX_SCAN; scanned += PAGE_SIZE) {
    const page = await mirror.listTopicMessages(connectionTopicId, { limit: PAGE_SIZE, before });
    for (const message of hcs10Messages(page)) {
      if (message.envelope.op !== "message" || message.payerAccountId !== agentAccountId) continue;
      const decision = parseDecision(message.envelope.data);
      if (decision?.skill === skill) return decision;
    }
    if (page.length < PAGE_SIZE) return null;
    before = page[page.length - 1]!.sequenceNumber;
  }
  return null;
}

/**
 * One agent step: the skill perceives and decides, the decision is sent as an
 * HCS-10 `message` on the connection topic (signed and paid for by the agent's
 * own account), and the result is read back from the Mirror Node so the
 * caller gets consensus proof rather than a local echo.
 */
export async function performAction(
  cfg: NetworkConfig,
  state: Pick<ConnectedState, "agent" | "connectionTopicId">,
  skill: AgentSkill,
  {
    connectionTopicId = state.connectionTopicId,
    mirror = new MirrorClient(cfg.mirrorNodeUrl),
  }: {
    /** Publish on another of the agent's connections (default: the peer connection). */
    connectionTopicId?: string;
    mirror?: MirrorClient;
  } = {},
): Promise<ActionResult> {
  await alignClockWithNetwork(mirror);
  const previous = await latestDecision(mirror, connectionTopicId, state.agent.accountId, skill.name);
  const outcome = await skill.decide({ mirror, previous });
  const decision: Decision = {
    schema: DECISION_SCHEMA,
    skill: skill.name,
    ...outcome,
    decidedAt: new Date().toISOString(),
  };
  const data = encodeDecision(decision);

  let sequenceNumber: number;
  try {
    const receipt = await identityClient(cfg, state.agent).sendMessage(
      connectionTopicId,
      data,
      `${skill.name}: ${decision.action}`,
    );
    const sequence = receipt.topicSequenceNumber?.toNumber();
    if (!sequence) throw new Error("receipt had no topic sequence number");
    sequenceNumber = sequence;
  } catch (error) {
    throw classifyHederaError(error, `publish the decision to connection topic ${connectionTopicId}`);
  }

  let verification: Verification | null = null;
  try {
    const message = await mirror.waitForTopicMessage(connectionTopicId, sequenceNumber);
    verification = verificationFor(cfg.network, cfg.mirrorNodeUrl, message);
  } catch (error) {
    if (!(error instanceof PassportError && error.code === "MIRROR_LAG")) throw error;
  }

  return { decision, topicId: connectionTopicId, sequenceNumber, verification };
}
