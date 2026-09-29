import { AIAgentCapability, type HCS10Client } from "@hashgraphonline/standards-sdk";
import type { OperatorConfig } from "../config";
import { PassportError } from "../errors";
import { MirrorClient } from "../mirror";
import {
  alignClockWithNetwork,
  connect,
  createAccount,
  createIdentity,
  ensureRegistry,
  operatorClient,
  registerInRegistry,
  type IdentitySpec,
} from "../passport";
import { readState, writeState, type PassportState, type RegisteredIdentity } from "../state";
import { hashscanAccountUrl, hashscanTopicUrl } from "../verify";
import { detail, runCli, step } from "./run";

/** Operator-side fees per passport (account creation) plus headroom; measured at ~0.1 HBAR on testnet. */
const FEE_MARGIN_HBAR = 2;
const TINYBAR_PER_HBAR = 100_000_000;

async function preflight(cfg: OperatorConfig, mirror: MirrorClient, passportsToFund: number): Promise<void> {
  const account = await mirror.getAccount(cfg.operatorId);
  if (!account) {
    throw new PassportError(
      "WRONG_NETWORK",
      `Operator ${cfg.operatorId} does not exist on ${cfg.network}.`,
      "Check HEDERA_NETWORK matches the network the account was created on.",
    );
  }
  const needed = passportsToFund * (cfg.initialBalanceHbar + FEE_MARGIN_HBAR);
  const balance = account.balanceTinybar / TINYBAR_PER_HBAR;
  if (balance < needed) {
    throw new PassportError(
      "INSUFFICIENT_BALANCE",
      `Operator ${cfg.operatorId} holds ${balance.toFixed(2)} HBAR; registration needs about ${needed} HBAR.`,
      "Top up at https://portal.hedera.com/faucet, or lower AGENT_INITIAL_BALANCE_HBAR.",
    );
  }
}

async function ensurePassport(
  role: "agent" | "peer",
  spec: IdentitySpec,
  cfg: OperatorConfig,
  operator: HCS10Client,
  state: PassportState,
  save: () => void,
): Promise<RegisteredIdentity> {
  step(`${role === "agent" ? "Agent" : "Peer"} passport: ${spec.name}`);

  let identity = state[role];
  if (!identity) {
    identity = await createAccount(operator, cfg.initialBalanceHbar);
    state[role] = identity;
    save(); // persist the key before anything else can fail
  }
  detail("account", `${identity.accountId}  ${hashscanAccountUrl(cfg.network, identity.accountId)}`);

  if (!identity.profileTopicId) {
    identity = await createIdentity(cfg, identity, spec, partial => {
      state[role] = { ...state[role]!, ...partial };
      save();
    });
    state[role] = identity;
    save();
  }
  detail("inbound topic", `${identity.inboundTopicId}  ${hashscanTopicUrl(cfg.network, identity.inboundTopicId!)}`);
  detail("outbound topic", `${identity.outboundTopicId}  ${hashscanTopicUrl(cfg.network, identity.outboundTopicId!)}`);
  detail("HCS-11 profile", `hcs://1/${identity.profileTopicId}`);

  if (!identity.registered) {
    state[role] = await registerInRegistry(cfg, identity, state.registryTopicId!);
    save();
  }
  detail("registered in", state.registryTopicId!);
  return state[role] as RegisteredIdentity;
}

runCli(async ({ cfg, statePath }) => {
  const mirror = new MirrorClient(cfg.mirrorNodeUrl);
  const state: PassportState = readState(statePath) ?? { version: 1, network: cfg.network };
  if (state.network !== cfg.network) {
    throw new PassportError(
      "WRONG_NETWORK",
      `${statePath} holds ${state.network} passports but HEDERA_NETWORK is ${cfg.network}.`,
      "Switch HEDERA_NETWORK back, or set PASSPORT_STATE_FILE to a new path for this network.",
    );
  }
  const save = () => writeState(statePath, state);

  const unfunded = (state.agent ? 0 : 1) + (state.peer ? 0 : 1);
  await preflight(cfg, mirror, unfunded);
  const drift = await alignClockWithNetwork(mirror);
  if (drift !== 0) detail("clock drift", `${drift}s vs network time (compensated)`);

  const operator = operatorClient(cfg);

  step("HCS-10 registry");
  state.registryTopicId = await ensureRegistry(operator, cfg.registryTopicId ?? state.registryTopicId);
  save();
  detail("registry topic", `${state.registryTopicId}  ${hashscanTopicUrl(cfg.network, state.registryTopicId)}`);

  const agent = await ensurePassport(
    "agent",
    { ...cfg.agent, capabilities: [AIAgentCapability.MARKET_INTELLIGENCE, AIAgentCapability.TRANSACTION_ANALYTICS] },
    cfg,
    operator,
    state,
    save,
  );
  const peer = await ensurePassport(
    "peer",
    {
      name: `${cfg.agent.name} Auditor`,
      description: `Opens an HCS-10 connection to ${cfg.agent.name} and receives every decision it publishes.`,
      model: "none",
      capabilities: [AIAgentCapability.COMPLIANCE_ANALYSIS, AIAgentCapability.MULTI_AGENT_COORDINATION],
    },
    cfg,
    operator,
    state,
    save,
  );

  step("HCS-10 connection (peer → agent)");
  if (!state.connectionTopicId) {
    state.connectionTopicId = await connect(cfg, peer, agent);
    save();
  }
  detail("connection topic", `${state.connectionTopicId}  ${hashscanTopicUrl(cfg.network, state.connectionTopicId)}`);

  console.log(`\n✔ Passports ready. State saved to ${statePath} (contains private keys — never commit it).`);
  console.log("  Next: `npm run agent:act` or `npm run dev` and open http://localhost:3000");
});
