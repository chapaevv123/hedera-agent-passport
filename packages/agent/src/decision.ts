import { z } from "zod";
import { PassportError } from "./errors";

export const DECISION_SCHEMA = "agent-passport/decision@1";

/**
 * Upper bound for the `data` field. standards-sdk moves any HCS-10 envelope
 * over 1000 bytes into an HCS-1 inscription; staying under this keeps every
 * decision readable straight from the connection topic on the Mirror Node.
 */
export const MAX_DECISION_BYTES = 700;

const Scalar = z.union([z.string(), z.number(), z.boolean(), z.null()]);

const DecisionSchema = z.object({
  schema: z.literal(DECISION_SCHEMA),
  /** Which skill produced it, e.g. "exchange-rate-watch". */
  skill: z.string().min(1),
  /** Machine-readable outcome, e.g. "ALERT_UP". */
  action: z.string().min(1),
  /** One sentence a human auditor can read. */
  reason: z.string(),
  /** The observations the decision was based on. */
  input: z.record(Scalar),
  /** Agent-local time. Hedera's consensus timestamp is the authoritative one. */
  decidedAt: z.string(),
});

export type Decision = z.infer<typeof DecisionSchema>;
export type DecisionInput = Decision["input"];

export function encodeDecision(decision: Decision): string {
  const data = JSON.stringify(DecisionSchema.parse(decision));
  const bytes = Buffer.byteLength(data, "utf8");
  if (bytes > MAX_DECISION_BYTES) {
    throw new PassportError(
      "PAYLOAD_TOO_LARGE",
      `Decision from "${decision.skill}" is ${bytes} bytes; the limit is ${MAX_DECISION_BYTES}.`,
      "Trim `input` to the observations that justify the action. Store bulky evidence elsewhere and put its hash in `input`.",
    );
  }
  return data;
}

/** Returns null for anything that is not a well-formed decision (other agents may share the topic). */
export function parseDecision(data: string | undefined): Decision | null {
  if (!data) return null;
  try {
    const result = DecisionSchema.safeParse(JSON.parse(data));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
