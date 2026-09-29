import { z } from "zod";
import type { TopicMessage } from "./mirror";

/**
 * The HCS-10 operations this template reads back from the Mirror Node.
 * Writing is done by standards-sdk; this is only the interpretation side.
 */
const EnvelopeSchema = z
  .object({
    p: z.literal("hcs-10"),
    op: z.enum([
      "register",
      "delete",
      "migrate",
      "connection_request",
      "connection_created",
      "connection_closed",
      "close_connection",
      "message",
      "transaction",
    ]),
    operator_id: z.string().optional(),
    account_id: z.string().optional(),
    data: z.string().optional(),
    m: z.string().optional(),
    connection_topic_id: z.string().optional(),
    connection_request_id: z.number().optional(),
    connected_account_id: z.string().optional(),
  })
  .passthrough();

export type Hcs10Envelope = z.infer<typeof EnvelopeSchema>;

export interface Hcs10Message extends TopicMessage {
  envelope: Hcs10Envelope;
}

export function parseEnvelope(contents: string): Hcs10Envelope | null {
  try {
    const result = EnvelopeSchema.safeParse(JSON.parse(contents));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

/** Keeps only valid HCS-10 messages; anything else on a public topic is noise. */
export function hcs10Messages(messages: TopicMessage[]): Hcs10Message[] {
  return messages.flatMap(message => {
    const envelope = parseEnvelope(message.contents);
    return envelope ? [{ ...message, envelope }] : [];
  });
}

/** `inboundTopicId@accountId` → accountId. */
export function accountOfOperatorId(operatorId: string | undefined): string | undefined {
  return operatorId?.split("@")[1];
}

type Hcs10TopicRole = "registry" | "inbound" | "outbound" | "connection";

export interface Hcs10TopicMemo {
  role: Hcs10TopicRole;
  ttl: number;
  /** inbound: owning account. connection: the inbound topic it was opened from. */
  ref?: string;
  /** connection only: the connection_request sequence number. */
  connectionId?: number;
}

const ROLE_BY_TYPE: Record<string, Hcs10TopicRole> = {
  "0": "inbound",
  "1": "outbound",
  "2": "connection",
  "3": "registry",
};

/**
 * Topic memos are how HCS-10 makes topics self-describing, e.g.
 * `hcs-10:0:60:0:0.0.123` is the inbound topic of account 0.0.123. Reading
 * the memo from the Mirror Node lets anyone check a topic really belongs to
 * the agent that claims it.
 */
export function parseTopicMemo(memo: string): Hcs10TopicMemo | null {
  const parts = memo.split(":");
  if (parts[0] !== "hcs-10" || parts.length < 4) return null;
  const role = ROLE_BY_TYPE[parts[3]!];
  const ttl = Number(parts[2]);
  if (!role || !Number.isFinite(ttl)) return null;
  const parsed: Hcs10TopicMemo = { role, ttl };
  if (parts[4]) parsed.ref = parts[4];
  if (role === "connection" && parts[5]) parsed.connectionId = Number(parts[5]);
  return parsed;
}
