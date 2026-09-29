import { performAction } from "../act";
import { exchangeRateWatch } from "../skills/exchange-rate-watch";
import { readState, requireConnectedState } from "../state";
import { detail, runCli, step } from "./run";

runCli(async ({ cfg, statePath }) => {
  const state = requireConnectedState(readState(statePath));

  step(`Skill "${exchangeRateWatch.name}" deciding as ${state.agent.accountId}`);
  const result = await performAction(cfg, state, exchangeRateWatch);
  detail("action", result.decision.action);
  detail("reason", result.decision.reason);
  detail("connection topic", `${result.topicId} #${result.sequenceNumber}`);

  if (!result.verification) {
    console.log(
      "\n⚠ Published, but the Mirror Node has not indexed it yet. Run `npm run agent:status` in a few seconds.",
    );
    return;
  }
  step("Verified on the Mirror Node");
  detail("consensus time", result.verification.consensusTimestamp);
  if (result.verification.transactionId) detail("transaction", result.verification.transactionId);
  detail("hashscan", result.verification.hashscanUrl);
  detail("mirror node", result.verification.mirrorUrl);
});
