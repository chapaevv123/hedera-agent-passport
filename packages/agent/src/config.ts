import { PrivateKey } from "@hashgraph/sdk";
import { PassportError } from "./errors";

export type Network = "testnet" | "mainnet";
type KeyType = "ed25519" | "ecdsa";

export interface OperatorConfig extends NetworkConfig {
  operatorId: string;
  /** DER-encoded private key, normalised so both key types round-trip. */
  operatorKey: string;
  keyType: KeyType;
  /** Existing HCS-10 registry topic to join; a new one is created when absent. */
  registryTopicId?: string;
  agent: AgentProfileConfig;
  /** HBAR each new passport account is funded with by the operator. */
  initialBalanceHbar: number;
}

export interface AgentProfileConfig {
  name: string;
  description: string;
  model: string;
}

const ENTITY_ID = /^0\.0\.\d+$/;

const DEFAULT_MIRROR: Record<Network, string> = {
  testnet: "https://testnet.mirrornode.hedera.com",
  mainnet: "https://mainnet-public.mirrornode.hedera.com",
};

function invalid(message: string, hint: string): PassportError {
  return new PassportError("INVALID_CONFIG", message, hint);
}

function parseNetwork(raw: string | undefined): Network {
  const value = (raw ?? "testnet").trim().toLowerCase();
  if (value === "testnet" || value === "mainnet") return value;
  throw new PassportError(
    "WRONG_NETWORK",
    `HEDERA_NETWORK="${raw}" is not supported.`,
    'Set HEDERA_NETWORK to "testnet" (recommended) or "mainnet".',
  );
}

/**
 * Accepts the formats the Hedera Portal hands out: DER (either curve) or a
 * 0x-prefixed raw ECDSA key. A bare raw hex key is ambiguous between curves,
 * so HEDERA_OPERATOR_KEY_TYPE must say which one it is.
 */
export function parsePrivateKey(raw: string, declaredType?: string): { der: string; keyType: KeyType } {
  const value = raw.trim();
  const type = declaredType?.trim().toLowerCase() || undefined;
  if (type !== undefined && type !== "ecdsa" && type !== "ed25519") {
    throw invalid(`HEDERA_OPERATOR_KEY_TYPE="${declaredType}" is not supported.`, 'Use "ecdsa" or "ed25519".');
  }

  try {
    let key: PrivateKey;
    // DER keys are at least 48 bytes; raw keys are 32, so a raw key that
    // happens to start with "30" is not mistaken for DER.
    if (/^30[0-9a-f]{94,}$/i.test(value)) {
      key = PrivateKey.fromStringDer(value);
    } else if (type === "ecdsa" || (type === undefined && value.startsWith("0x"))) {
      key = PrivateKey.fromStringECDSA(value);
    } else if (type === "ed25519") {
      key = PrivateKey.fromStringED25519(value);
    } else {
      throw new Error("ambiguous raw key");
    }
    return { der: key.toStringDer(), keyType: key.type === "secp256k1" ? "ecdsa" : "ed25519" };
  } catch {
    throw invalid(
      "HEDERA_OPERATOR_KEY could not be parsed.",
      "Paste the DER-encoded key from the Hedera Portal (starts with 302e or 3030), or a 0x-prefixed ECDSA hex key. " +
        "For a raw hex key without 0x, also set HEDERA_OPERATOR_KEY_TYPE.",
    );
  }
}

function parseBalance(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return 5;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0 || value > 100) {
    throw invalid(
      `AGENT_INITIAL_BALANCE_HBAR="${raw}" is not a number between 0 and 100.`,
      "Each passport account pays its own topic, profile and message fees; 5 HBAR lasts for hundreds of decisions.",
    );
  }
  return value;
}

export interface NetworkConfig {
  network: Network;
  mirrorNodeUrl: string;
}

/** Enough to read from the network and to act as an already-registered agent; no operator key needed. */
export function loadNetworkConfig(env: Record<string, string | undefined>): NetworkConfig {
  const network = parseNetwork(env.HEDERA_NETWORK);
  return { network, mirrorNodeUrl: (env.MIRROR_NODE_URL?.trim() || DEFAULT_MIRROR[network]).replace(/\/+$/, "") };
}

export function loadOperatorConfig(env: Record<string, string | undefined>): OperatorConfig {
  const { network, mirrorNodeUrl } = loadNetworkConfig(env);

  const operatorId = env.HEDERA_OPERATOR_ID?.trim();
  const rawKey = env.HEDERA_OPERATOR_KEY?.trim();
  if (!operatorId || !rawKey) {
    throw new PassportError(
      "MISSING_CREDENTIALS",
      "HEDERA_OPERATOR_ID and HEDERA_OPERATOR_KEY must both be set.",
      "Copy .env.example to .env and paste a testnet account from https://portal.hedera.com.",
    );
  }
  if (!ENTITY_ID.test(operatorId)) {
    throw invalid(`HEDERA_OPERATOR_ID="${operatorId}" is not an account ID.`, "Use the 0.0.x form, e.g. 0.0.1234567.");
  }
  const { der, keyType } = parsePrivateKey(rawKey, env.HEDERA_OPERATOR_KEY_TYPE);

  const registryTopicId = env.HCS10_REGISTRY_TOPIC_ID?.trim() || undefined;
  if (registryTopicId && !ENTITY_ID.test(registryTopicId)) {
    throw invalid(
      `HCS10_REGISTRY_TOPIC_ID="${registryTopicId}" is not a topic ID.`,
      "Use the 0.0.x form or leave it empty.",
    );
  }

  return {
    network,
    operatorId,
    operatorKey: der,
    keyType,
    mirrorNodeUrl,
    registryTopicId,
    initialBalanceHbar: parseBalance(env.AGENT_INITIAL_BALANCE_HBAR),
    agent: {
      name: env.AGENT_NAME?.trim() || "Passport Demo Agent",
      description:
        env.AGENT_DESCRIPTION?.trim() ||
        "Watches the Hedera HBAR/USD exchange rate and publishes each decision over HCS-10.",
      model: env.AGENT_MODEL?.trim() || "rule-based",
    },
  };
}
