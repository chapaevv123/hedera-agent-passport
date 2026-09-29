import { describe, expect, it } from "vitest";
import { DECISION_SCHEMA, encodeDecision, MAX_DECISION_BYTES, parseDecision, type Decision } from "../src/decision";
import { classifyHederaError, PassportError } from "../src/errors";
import { decideOnRate, MOVE_THRESHOLD_PERCENT } from "../src/skills/exchange-rate-watch";

const decision = (overrides: Partial<Decision> = {}): Decision => ({
  schema: DECISION_SCHEMA,
  skill: "exchange-rate-watch",
  action: "HOLD",
  reason: "steady",
  input: { usdPerHbar: 0.08 },
  decidedAt: "2026-09-29T00:00:00.000Z",
  ...overrides,
});

describe("decision envelope", () => {
  it("round-trips through the HCS-10 data field", () => {
    expect(parseDecision(encodeDecision(decision()))).toEqual(decision());
  });

  it("refuses payloads that would push the HCS-10 message into an HCS-1 inscription", () => {
    const big = decision({ input: { blob: "x".repeat(MAX_DECISION_BYTES) } });
    expect(() => encodeDecision(big)).toThrow(PassportError);
    try {
      encodeDecision(big);
    } catch (error) {
      expect((error as PassportError).code).toBe("PAYLOAD_TOO_LARGE");
    }
  });

  it("counts bytes, not characters", () => {
    const nearLimit = MAX_DECISION_BYTES - Buffer.byteLength(encodeDecision(decision({ reason: "" })));
    expect(() => encodeDecision(decision({ reason: "a".repeat(nearLimit) }))).not.toThrow();
    expect(() => encodeDecision(decision({ reason: "é".repeat(nearLimit) }))).toThrow(PassportError);
  });

  it("ignores other traffic on a shared connection topic", () => {
    expect(parseDecision(undefined)).toBeNull();
    expect(parseDecision("hello from another agent")).toBeNull();
    expect(parseDecision(JSON.stringify({ ...decision(), schema: "someone-else@1" }))).toBeNull();
    expect(parseDecision(JSON.stringify({ ...decision(), input: { nested: { x: 1 } } }))).toBeNull();
  });
});

describe("exchange-rate-watch rule", () => {
  const rate = (usd: number) => ({
    centEquivalent: Math.round(usd * 100 * 30000),
    hbarEquivalent: 30000,
    timestamp: "1789488065.280160388",
    expirationTime: 0,
  });
  const previous = (usd: number) => decision({ input: { usdPerHbar: usd } });

  it("sets a baseline when the log has no usable previous observation", () => {
    expect(decideOnRate(rate(0.08), null).action).toBe("BASELINE");
    expect(decideOnRate(rate(0.08), decision({ input: { usdPerHbar: "n/a" } })).action).toBe("BASELINE");
  });

  it("alerts only beyond the threshold, in both directions", () => {
    const up = 1 + (MOVE_THRESHOLD_PERCENT + 0.1) / 100;
    const down = 1 - (MOVE_THRESHOLD_PERCENT + 0.1) / 100;
    const inside = 1 + (MOVE_THRESHOLD_PERCENT - 0.1) / 100;
    expect(decideOnRate(rate(0.08 * up), previous(0.08)).action).toBe("ALERT_UP");
    expect(decideOnRate(rate(0.08 * down), previous(0.08)).action).toBe("ALERT_DOWN");
    expect(decideOnRate(rate(0.08 * inside), previous(0.08)).action).toBe("HOLD");
  });

  it("records the evidence it decided on", () => {
    const outcome = decideOnRate(rate(0.0808), previous(0.08));
    expect(outcome.input).toMatchObject({ usdPerHbar: 0.0808, previousUsdPerHbar: 0.08, changePercent: 1 });
    expect(() => encodeDecision(decision(outcome))).not.toThrow();
  });
});

describe("classifyHederaError", () => {
  const withStatus = (status: string) =>
    Object.assign(new Error(`receipt for transaction failed with status ${status}`), { status });

  it.each([
    ["INSUFFICIENT_PAYER_BALANCE", "INSUFFICIENT_BALANCE"],
    ["INVALID_SIGNATURE", "KEY_MISMATCH"],
    ["INVALID_ACCOUNT_ID", "WRONG_NETWORK"],
    ["INVALID_TRANSACTION_START", "CLOCK_SKEW"],
    ["INVALID_TOPIC_ID", "TOPIC_NOT_READY"],
  ])("maps %s to %s with an actionable hint", (status, code) => {
    const error = classifyHederaError(withStatus(status), "do the thing");
    expect(error.code).toBe(code);
    expect(error.message).toContain(status);
    expect(error.hint.length).toBeGreaterThan(20);
  });

  it("recognises statuses the standards-sdk only reports inside its message", () => {
    const wrapped = new Error("transaction 0.0.1@1.2 failed precheck with status INVALID_TRANSACTION_START");
    expect(classifyHederaError(wrapped, "create a topic").code).toBe("CLOCK_SKEW");
  });

  it("keeps unknown failures visible instead of swallowing them", () => {
    const error = classifyHederaError(new Error("socket hang up"), "send a message");
    expect(error.code).toBe("SUBMIT_FAILED");
    expect(error.message).toContain("socket hang up");
    expect(error.cause).toBeInstanceOf(Error);
  });

  it("passes PassportErrors through untouched", () => {
    const original = new PassportError("MIRROR_LAG", "lag", "wait");
    expect(classifyHederaError(original, "x")).toBe(original);
  });
});
