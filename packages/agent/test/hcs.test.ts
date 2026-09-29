import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decodeHcs1, encodeHcs1 } from "../src/hcs1";
import { accountOfOperatorId, hcs10Messages, parseEnvelope, parseTopicMemo } from "../src/hcs10";
import type { TopicMessage } from "../src/mirror";

const asMessages = (contents: string[]): Pick<TopicMessage, "contents">[] => contents.map(c => ({ contents: c }));

describe("HCS-1 file codec", () => {
  const profile = Buffer.from(
    JSON.stringify({ version: "1.0", type: 1, display_name: "Agent", bio: "x".repeat(4000) }),
  );

  it("round-trips content and pins it to the sha256 in the memo", () => {
    const file = encodeHcs1(profile, "application/json");
    expect(file.memo).toMatch(/^[0-9a-f]{64}:zstd:base64$/);
    const decoded = decodeHcs1(file.memo, asMessages(file.messages));
    expect(decoded.mimeType).toBe("application/json");
    expect(decoded.content.equals(profile)).toBe(true);
  });

  it("keeps every message within the 1024-byte HCS-1 chunk limit", () => {
    const incompressible = randomBytes(5000);
    const file = encodeHcs1(incompressible, "application/octet-stream");
    expect(file.messages.length).toBeGreaterThan(1);
    for (const m of file.messages) expect(Buffer.byteLength(m)).toBeLessThanOrEqual(1024);
  });

  it("reassembles chunks by `o`, not by arrival order", () => {
    const incompressible = randomBytes(3000);
    const file = encodeHcs1(incompressible, "application/octet-stream");
    const shuffled = [...file.messages].reverse();
    expect(decodeHcs1(file.memo, asMessages(shuffled)).content.equals(incompressible)).toBe(true);
  });

  it("rejects content that does not match the memo hash", () => {
    const file = encodeHcs1(profile, "application/json");
    const other = encodeHcs1(Buffer.from("tampered"), "application/json");
    expect(() => decodeHcs1(file.memo, asMessages(other.messages))).toThrow(/does not match/);
  });

  it("rejects non-HCS-1 memos", () => {
    expect(() => decodeHcs1("hcs-10:0:60:1", [])).toThrow(/not an HCS-1/);
  });
});

describe("HCS-10 topic memos", () => {
  it("identifies each topic role", () => {
    expect(parseTopicMemo("hcs-10:0:60:0:0.0.42")).toEqual({ role: "inbound", ttl: 60, ref: "0.0.42" });
    expect(parseTopicMemo("hcs-10:0:60:1")).toEqual({ role: "outbound", ttl: 60 });
    expect(parseTopicMemo("hcs-10:1:60:2:0.0.7:12")).toEqual({
      role: "connection",
      ttl: 60,
      ref: "0.0.7",
      connectionId: 12,
    });
    expect(parseTopicMemo("hcs-10:0:86400:3")).toEqual({ role: "registry", ttl: 86400 });
  });

  it("returns null for memos from other standards", () => {
    expect(parseTopicMemo("abc:zstd:base64")).toBeNull();
    expect(parseTopicMemo("hcs-10:0:60:9")).toBeNull();
    expect(parseTopicMemo("")).toBeNull();
  });
});

describe("HCS-10 envelopes", () => {
  const message = (contents: string): TopicMessage => ({
    topicId: "0.0.1",
    sequenceNumber: 1,
    consensusTimestamp: "1.0",
    payerAccountId: "0.0.2",
    contents,
  });

  it("parses standard operations", () => {
    const envelope = parseEnvelope(
      JSON.stringify({
        p: "hcs-10",
        op: "connection_created",
        connection_topic_id: "0.0.9",
        operator_id: "0.0.5@0.0.6",
      }),
    );
    expect(envelope?.op).toBe("connection_created");
    expect(envelope?.connection_topic_id).toBe("0.0.9");
  });

  it("drops noise that a public topic can receive", () => {
    const valid = JSON.stringify({ p: "hcs-10", op: "message", data: "hi" });
    const result = hcs10Messages([
      message("not json"),
      message(JSON.stringify({ p: "hcs-2", op: "register" })),
      message(JSON.stringify({ p: "hcs-10", op: "unknown_op" })),
      message(valid),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]!.envelope.data).toBe("hi");
  });

  it("extracts the account from an operator ID", () => {
    expect(accountOfOperatorId("0.0.5@0.0.6")).toBe("0.0.6");
    expect(accountOfOperatorId(undefined)).toBeUndefined();
  });
});
