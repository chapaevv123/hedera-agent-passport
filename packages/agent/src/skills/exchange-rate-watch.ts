import type { ExchangeRate } from "../mirror";
import type { AgentSkill, SkillOutcome } from "./types";
import type { Decision } from "../decision";

/** Relative move, in percent, that counts as a signal rather than noise. */
export const MOVE_THRESHOLD_PERCENT = 0.5;

export function usdPerHbar(rate: ExchangeRate): number {
  return rate.centEquivalent / rate.hbarEquivalent / 100;
}

/**
 * Pure decision rule, separated from I/O so it can be tested exhaustively:
 * compare the network's HBAR/USD rate with the rate this skill last reported.
 */
export function decideOnRate(rate: ExchangeRate, previous: Decision | null): SkillOutcome {
  const price = Number(usdPerHbar(rate).toFixed(6));
  const input = { usdPerHbar: price, rateTimestamp: rate.timestamp, source: "mirror-node/network/exchangerate" };

  const last = previous?.input.usdPerHbar;
  if (typeof last !== "number" || last <= 0) {
    return { action: "BASELINE", reason: `First observation: 1 HBAR = $${price}.`, input };
  }

  const changePercent = Number((((price - last) / last) * 100).toFixed(3));
  const withChange = { ...input, previousUsdPerHbar: last, changePercent };
  if (changePercent >= MOVE_THRESHOLD_PERCENT) {
    return {
      action: "ALERT_UP",
      reason: `HBAR rose ${changePercent}% since the last report ($${last} → $${price}).`,
      input: withChange,
    };
  }
  if (changePercent <= -MOVE_THRESHOLD_PERCENT) {
    return {
      action: "ALERT_DOWN",
      reason: `HBAR fell ${-changePercent}% since the last report ($${last} → $${price}).`,
      input: withChange,
    };
  }
  return {
    action: "HOLD",
    reason: `Move of ${changePercent}% is inside the ±${MOVE_THRESHOLD_PERCENT}% band; nothing to act on.`,
    input: withChange,
  };
}

export const exchangeRateWatch: AgentSkill = {
  name: "exchange-rate-watch",
  description: "Reads Hedera's own HBAR/USD exchange rate and reports moves beyond ±0.5%.",
  async decide({ mirror, previous }) {
    return decideOnRate(await mirror.getExchangeRate(), previous);
  },
};
