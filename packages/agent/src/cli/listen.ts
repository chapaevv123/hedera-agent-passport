import { PassportError } from "../errors";
import { listenOnce } from "../listen";
import { MirrorClient } from "../mirror";
import { exchangeRateWatch } from "../skills/exchange-rate-watch";
import { readState, requireConnectedState } from "../state";
import { detail, runCli, step } from "./run";

const POLL_MS = 5000;

/**
 * Keeps the agent reachable: accepts HCS-10 connection requests from any
 * agent and answers each peer message with a fresh decision. Ctrl-C to stop.
 */
runCli(async ({ cfg, statePath }) => {
  const state = requireConnectedState(readState(statePath));
  const mirror = new MirrorClient(cfg.mirrorNodeUrl);
  const seen = new Set<string>();

  step(`Listening as ${state.agent.accountId} on inbound topic ${state.agent.inboundTopicId} (Ctrl-C to stop)`);
  for (;;) {
    try {
      await listenOnce(cfg, state, exchangeRateWatch, mirror, seen, event => {
        if (event.kind === "accepted") {
          step(`Accepted connection from ${event.requesterAccountId}`);
          detail("request", `#${event.requestSequence}`);
          detail("connection topic", event.connectionTopicId);
        } else {
          step(`Answered message #${event.to} on ${event.connectionTopicId}`);
          detail("action", event.result.decision.action);
          detail("hashscan", event.result.verification?.hashscanUrl ?? "(Mirror Node still indexing)");
        }
      });
    } catch (error) {
      // Transient network trouble must not kill a long-running listener; report it and poll again.
      if (!(error instanceof PassportError)) throw error;
      console.error(`✖ ${error.code}: ${error.message}\n  → ${error.hint}`);
    }
    await new Promise(resolve => setTimeout(resolve, POLL_MS));
  }
});
