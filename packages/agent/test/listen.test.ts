import { describe, expect, it } from "vitest";
import type { Hcs10Envelope, Hcs10Message } from "../src/hcs10";
import { awaitsReply, connectionTopics, pendingRequests } from "../src/listen";

const AGENT = "0.0.100";

const msg = (sequenceNumber: number, payerAccountId: string, envelope: Omit<Hcs10Envelope, "p">): Hcs10Message => ({
  topicId: "0.0.1",
  sequenceNumber,
  consensusTimestamp: `1790000000.${sequenceNumber}`,
  payerAccountId,
  contents: "",
  envelope: { p: "hcs-10", ...envelope } as Hcs10Envelope,
});

const request = (seq: number, account: string, payer = account) =>
  msg(seq, payer, { op: "connection_request", operator_id: `0.0.9${seq}@${account}` });
const created = (requestId: number, topic: string, payer = AGENT) =>
  msg(50 + requestId, payer, {
    op: "connection_created",
    connection_request_id: requestId,
    connection_topic_id: topic,
  });

describe("pendingRequests", () => {
  it("returns requests the agent has not answered on its outbound topic", () => {
    const inbound = [request(1, "0.0.200"), request(2, "0.0.300")];
    const outbound = [created(1, "0.0.500")];
    expect(pendingRequests(inbound, outbound, AGENT)).toEqual([{ sequenceNumber: 2, requesterAccountId: "0.0.300" }]);
  });

  it("ignores a request whose operator_id names someone other than the payer", () => {
    expect(pendingRequests([request(3, "0.0.200", "0.0.666")], [], AGENT)).toEqual([]);
  });

  it("does not trust answers recorded on the outbound topic by anyone but the agent", () => {
    const forgedAnswer = created(4, "0.0.501", "0.0.666");
    expect(pendingRequests([request(4, "0.0.200")], [forgedAnswer], AGENT)).toHaveLength(1);
  });

  it("ignores the agent's own requests and non-request traffic", () => {
    const inbound = [request(5, AGENT), msg(6, "0.0.200", { op: "message", data: "hi" })];
    expect(pendingRequests(inbound, [], AGENT)).toEqual([]);
  });
});

describe("connectionTopics", () => {
  it("lists each connection the agent recorded, once", () => {
    const outbound = [
      created(1, "0.0.500"),
      created(1, "0.0.500"),
      created(2, "0.0.501"),
      created(3, "0.0.502", "0.0.666"),
    ];
    expect(connectionTopics(outbound, AGENT)).toEqual(["0.0.500", "0.0.501"]);
  });
});

describe("awaitsReply", () => {
  it("is true only when a peer spoke last", () => {
    expect(awaitsReply(msg(1, "0.0.200", { op: "message", data: "status?" }), AGENT)).toBe(true);
    expect(awaitsReply(msg(2, AGENT, { op: "message", data: "decision" }), AGENT)).toBe(false);
    expect(awaitsReply(msg(3, "0.0.200", { op: "close_connection" }), AGENT)).toBe(false);
    expect(awaitsReply(undefined, AGENT)).toBe(false);
  });
});
