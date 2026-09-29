import {
  AIAgentCapability,
  AIAgentType,
  buildHcs10CreateOutboundTopicTx,
  HCS10Client,
  HCS11Client,
  InboundTopicType,
} from "@hashgraphonline/standards-sdk";
import { Cache, PrivateKey } from "@hashgraph/sdk";
import type { AgentProfileConfig, NetworkConfig, OperatorConfig } from "./config";
import { classifyHederaError, PassportError } from "./errors";
import { writeHcs1File } from "./hcs1";
import { MirrorClient } from "./mirror";
import type { PassportIdentity, RegisteredIdentity } from "./state";

/** TTL hint written into HCS-10 topic memos, as the SDK's own default. */
const TOPIC_TTL_SECONDS = 60;

/**
 * Hedera rejects transactions whose valid-start lies in the future
 * (INVALID_TRANSACTION_START), which happens whenever the local clock runs a
 * few seconds fast — common on VMs and Windows without time sync. The Hedera
 * SDK has a process-wide drift correction for exactly this; measure the drift
 * against the Mirror Node once and apply it before signing anything.
 * Returns the applied drift so callers can report it.
 */
export async function alignClockWithNetwork(mirror: MirrorClient): Promise<number> {
  const drift = await mirror.clockDriftSeconds();
  Cache.setTimeDrift(drift);
  return drift;
}

function hcs10Client(
  cfg: NetworkConfig,
  accountId: string,
  privateKey: string,
  keyType: "ed25519" | "ecdsa",
): HCS10Client {
  return new HCS10Client({
    network: cfg.network,
    operatorId: accountId,
    operatorPrivateKey: privateKey,
    keyType,
    logLevel: "warn",
    mirrorNode: { customUrl: cfg.mirrorNodeUrl },
  });
}

/** The developer's funded account: pays for new passport accounts and the registry. */
export function operatorClient(cfg: OperatorConfig): HCS10Client {
  return hcs10Client(cfg, cfg.operatorId, cfg.operatorKey, cfg.keyType);
}

/** A passport account acting as itself — it signs and pays for its own HCS-10 traffic. */
export function identityClient(cfg: NetworkConfig, identity: PassportIdentity): HCS10Client {
  // HCS10Client.createAccount always generates ED25519 keys.
  return hcs10Client(cfg, identity.accountId, identity.privateKey, "ed25519");
}

/**
 * An HCS-10 registry is an HCS-2 topic that agents announce themselves on.
 * Reuses HCS10_REGISTRY_TOPIC_ID or the one from a previous run; otherwise
 * creates a public registry owned by the operator.
 */
export async function ensureRegistry(operator: HCS10Client, existing: string | undefined): Promise<string> {
  if (existing) return existing;
  const result = await operator.createRegistryTopic({ adminKey: true, submitKey: false });
  if (!result.success || !result.topicId) {
    throw classifyHederaError(new Error(result.error ?? "no topic ID returned"), "create the HCS-10 registry topic");
  }
  return result.topicId;
}

export async function createAccount(operator: HCS10Client, initialBalanceHbar: number): Promise<PassportIdentity> {
  try {
    const account = await operator.createAccount(initialBalanceHbar);
    return { accountId: account.accountId, privateKey: account.privateKey };
  } catch (error) {
    throw classifyHederaError(error, "create the passport account");
  }
}

export interface IdentitySpec extends AgentProfileConfig {
  capabilities: AIAgentCapability[];
}

/**
 * Gives a passport account its HCS-10 identity, one resumable step at a time:
 * an outbound topic (only the agent may write), a public inbound topic
 * (anyone may request a connection), and an HCS-11 profile linking both,
 * stored as an HCS-1 file and referenced from the account memo. `onProgress`
 * receives each new ID so the caller can persist it before the next step.
 */
export async function createIdentity(
  cfg: NetworkConfig,
  identity: PassportIdentity,
  spec: IdentitySpec,
  onProgress: (partial: Partial<PassportIdentity>) => void,
): Promise<PassportIdentity> {
  const client = identityClient(cfg, identity);

  const outboundTopicId = identity.outboundTopicId ?? (await createOutboundTopic(client, identity));
  onProgress({ outboundTopicId });

  const inboundTopicId = identity.inboundTopicId ?? (await createInboundTopic(client, identity));
  onProgress({ inboundTopicId });

  const profileTopicId =
    identity.profileTopicId ?? (await writeProfile(cfg, identity, spec, inboundTopicId, outboundTopicId));
  return { ...identity, outboundTopicId, inboundTopicId, profileTopicId };
}

async function createOutboundTopic(client: HCS10Client, identity: PassportIdentity): Promise<string> {
  try {
    const tx = buildHcs10CreateOutboundTopicTx({
      ttl: TOPIC_TTL_SECONDS,
      adminKey: true,
      submitKey: true,
      operatorPublicKey: PrivateKey.fromStringDer(identity.privateKey).publicKey,
    });
    const receipt = await (await tx.execute(client.getClient())).getReceipt(client.getClient());
    return receipt.topicId!.toString();
  } catch (error) {
    throw classifyHederaError(error, `create the outbound topic for ${identity.accountId}`);
  }
}

async function createInboundTopic(client: HCS10Client, identity: PassportIdentity): Promise<string> {
  try {
    return await client.createInboundTopic(identity.accountId, InboundTopicType.PUBLIC, TOPIC_TTL_SECONDS);
  } catch (error) {
    throw classifyHederaError(error, `create the inbound topic for ${identity.accountId}`);
  }
}

async function writeProfile(
  cfg: NetworkConfig,
  identity: PassportIdentity,
  spec: IdentitySpec,
  inboundTopicId: string,
  outboundTopicId: string,
): Promise<string> {
  const hcs11 = new HCS11Client({
    network: cfg.network,
    auth: { operatorId: identity.accountId, privateKey: identity.privateKey },
    keyType: "ed25519",
    logLevel: "warn",
  });
  const profile = hcs11.createAIAgentProfile(spec.name, AIAgentType.AUTONOMOUS, spec.capabilities, spec.model, {
    alias: spec.name.toLowerCase().replace(/\s+/g, "_"),
    bio: spec.description,
    inboundTopicId,
    outboundTopicId,
  });
  const validation = hcs11.validateProfile(profile);
  if (!validation.valid) {
    throw new PassportError(
      "INVALID_CONFIG",
      `HCS-11 profile is invalid: ${validation.errors.join(", ")}`,
      "Check AGENT_NAME, AGENT_DESCRIPTION and AGENT_MODEL.",
    );
  }

  const topicId = await writeHcs1File(
    identityClient(cfg, identity).getClient(),
    PrivateKey.fromStringDer(identity.privateKey),
    Buffer.from(hcs11.profileToJSONString(profile)),
    "application/json",
  );

  const memo = await hcs11.updateAccountMemoWithProfile(identity.accountId, topicId);
  if (!memo.success) {
    throw classifyHederaError(new Error(memo.error), `point the account memo of ${identity.accountId} at its profile`);
  }
  return topicId;
}

/** Posts the HCS-10 `register` operation for the identity to the registry topic. */
export async function registerInRegistry(
  cfg: NetworkConfig,
  identity: PassportIdentity,
  registryTopicId: string,
): Promise<RegisteredIdentity> {
  if (!identity.inboundTopicId || !identity.outboundTopicId || !identity.profileTopicId) {
    throw new PassportError(
      "NOT_REGISTERED",
      `${identity.accountId} has no HCS-10 topics yet.`,
      "Topics must exist before registering; re-run `npm run agent:register`.",
    );
  }
  try {
    await identityClient(cfg, identity).registerAgent(
      registryTopicId,
      identity.accountId,
      identity.inboundTopicId,
      "Agent Passport registration",
    );
  } catch (error) {
    throw classifyHederaError(error, `register ${identity.accountId} in registry ${registryTopicId}`);
  }
  return { ...identity, registered: true } as RegisteredIdentity;
}

async function waitForProfileMemo(
  mirror: MirrorClient,
  identity: RegisteredIdentity,
  timeoutMs = 30_000,
): Promise<void> {
  const expected = `hcs-11:hcs://1/${identity.profileTopicId}`;
  const deadline = Date.now() + timeoutMs;
  while ((await mirror.getAccount(identity.accountId))?.memo !== expected) {
    if (Date.now() > deadline) {
      throw new PassportError(
        "MIRROR_LAG",
        `The Mirror Node does not show the HCS-11 memo of ${identity.accountId} after ${timeoutMs / 1000}s.`,
        "The memo update is final on the network; re-run `npm run agent:register` in a minute to open the connection.",
      );
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
}

/**
 * Runs the full HCS-10 handshake: `requester` sends `connection_request` to
 * the target's inbound topic, the target answers with `connection_created`
 * and a new connection topic keyed to both accounts, and the requester
 * records the confirmation on its outbound topic.
 */
export async function connect(
  cfg: NetworkConfig,
  requester: RegisteredIdentity,
  target: RegisteredIdentity,
): Promise<string> {
  // The SDK resolves both parties' profiles through the Mirror Node, which
  // may not have indexed a memo set seconds ago.
  const mirror = new MirrorClient(cfg.mirrorNodeUrl);
  await Promise.all([waitForProfileMemo(mirror, requester), waitForProfileMemo(mirror, target)]);

  const requesterClient = identityClient(cfg, requester);
  const targetClient = identityClient(cfg, target);

  let requestSequence: number;
  try {
    const receipt = await requesterClient.submitConnectionRequest(
      target.inboundTopicId,
      "Agent Passport: open decision channel",
    );
    const sequence = receipt.topicSequenceNumber?.toNumber();
    if (!sequence) throw new Error("receipt had no topic sequence number");
    requestSequence = sequence;
  } catch (error) {
    throw classifyHederaError(error, `send connection_request to ${target.inboundTopicId}`);
  }

  try {
    await targetClient.handleConnectionRequest(target.inboundTopicId, requester.accountId, requestSequence);
  } catch (error) {
    throw classifyHederaError(error, `accept connection request #${requestSequence}`);
  }

  try {
    const confirmation = await requesterClient.waitForConnectionConfirmation(
      target.inboundTopicId,
      requestSequence,
      30,
      2000,
      true,
    );
    return confirmation.connectionTopicId;
  } catch (error) {
    throw new PassportError(
      "CONNECTION_TIMEOUT",
      `No connection_created for request #${requestSequence} on ${target.inboundTopicId} within 60s.`,
      "Usually Mirror Node lag. Re-run `npm run agent:register`; the passports are kept and only the connection is retried.",
      { cause: error },
    );
  }
}
