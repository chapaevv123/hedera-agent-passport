import { PassportError } from "../errors";
import { MirrorClient } from "../mirror";
import { readState } from "../state";
import { consensusToIso } from "../verify";
import { readPassport } from "../view";
import { detail, runCli, step } from "./run";

/** Prints the agent's passport as the network sees it. Takes an optional account ID to inspect any HCS-10 agent. */
runCli(async ({ cfg, statePath }) => {
  const state = readState(statePath);
  const accountId = process.argv[2] ?? state?.agent?.accountId;
  if (!accountId) {
    throw new PassportError(
      "NOT_REGISTERED",
      "No agent in local state and no account ID given.",
      "Run `npm run agent:register`, or pass an account: `npm run agent:status -- 0.0.1234`.",
    );
  }

  const view = await readPassport(new MirrorClient(cfg.mirrorNodeUrl), cfg.network, accountId, state?.registryTopicId);
  if (!view) {
    console.log(`Account ${accountId} does not exist on ${cfg.network}.`);
    return;
  }

  step(`Passport ${view.accountId} (${view.balanceHbar.toFixed(2)} HBAR)`);
  detail("hashscan", view.accountUrl);
  if (!view.profile) {
    console.log(`  HCS-11 profile unavailable: ${view.profileError}`);
    return;
  }
  detail("name", view.profile.displayName);
  detail("profile", `hcs://1/${view.profile.topicId}`);
  for (const topic of [view.inbound, view.outbound]) {
    if (topic) detail(topic.verified ? "topic ✔" : "topic ✖", `${topic.topicId}  "${topic.memo}"`);
  }
  detail(
    "registry",
    view.registration ? `${view.registration.registryTopicId} #${view.registration.sequenceNumber}` : "not found",
  );

  step(`Connections (${view.connections.length})`);
  for (const c of view.connections) detail(c.connectionTopicId, `peer ${c.peerAccountId ?? "?"}`);

  step(`Decisions (${view.decisions.length})`);
  for (const { decision, verification } of view.decisions.slice(0, 10)) {
    detail(consensusToIso(verification.consensusTimestamp), `${decision.action} — ${decision.reason}`);
    detail("", verification.hashscanUrl);
  }
});
