import { describe, expect, it } from "vitest";
import { DECISION_SCHEMA } from "../src/decision";
import { encodeHcs1 } from "../src/hcs1";
import { MirrorClient } from "../src/mirror";
import { readPassport } from "../src/view";

const BASE = "https://mirror.test";
const AGENT = "0.0.100";
const [INBOUND, OUTBOUND, PROFILE, REGISTRY, CONNECTION] = ["0.0.101", "0.0.102", "0.0.103", "0.0.9", "0.0.200"];

let seq = 0;
const message = (topic: string, payer: string, body: unknown) => ({
  topic_id: topic,
  sequence_number: ++seq,
  consensus_timestamp: `17906825${String(seq).padStart(2, "0")}.000000001`,
  payer_account_id: payer,
  message: Buffer.from(typeof body === "string" ? body : JSON.stringify(body)).toString("base64"),
});

const decisionData = (action: string) =>
  JSON.stringify({
    schema: DECISION_SCHEMA,
    skill: "s",
    action,
    reason: "r",
    input: {},
    decidedAt: "2026-09-29T00:00:00Z",
  });

function fakeNetwork(options: { inboundMemo?: string; profileBytes?: Buffer } = {}) {
  const profile = Buffer.from(
    JSON.stringify({
      version: "1.0",
      type: 1,
      display_name: "Test Agent",
      inboundTopicId: INBOUND,
      outboundTopicId: OUTBOUND,
      aiAgent: { type: 1, capabilities: [9, 16], model: "m" },
    }),
  );
  const file = encodeHcs1(profile, "application/json");
  const served = options.profileBytes ? encodeHcs1(options.profileBytes, "application/json").messages : file.messages;

  const routes: Record<string, unknown> = {
    [`/accounts/${AGENT}?transactions=false`]: {
      account: AGENT,
      memo: `hcs-11:hcs://1/${PROFILE}`,
      balance: { balance: 5e8 },
    },
    [`/topics/${PROFILE}`]: { topic_id: PROFILE, memo: file.memo },
    [`/topics/${PROFILE}/messages?limit=100&order=asc`]: {
      messages: served.map(c => message(PROFILE, AGENT, c)),
    },
    [`/topics/${INBOUND}`]: { topic_id: INBOUND, memo: options.inboundMemo ?? `hcs-10:0:60:0:${AGENT}` },
    [`/topics/${OUTBOUND}`]: { topic_id: OUTBOUND, memo: "hcs-10:0:60:1" },
    [`/topics/${REGISTRY}/messages?limit=100&order=desc`]: {
      messages: [
        message(REGISTRY, "0.0.555", { p: "hcs-10", op: "register", account_id: "0.0.555", m: "someone else" }),
        message(REGISTRY, AGENT, { p: "hcs-10", op: "register", account_id: AGENT, m: "hi" }),
      ],
    },
    [`/topics/${OUTBOUND}/messages?limit=100&order=desc`]: {
      messages: [
        message(OUTBOUND, AGENT, {
          p: "hcs-10",
          op: "connection_created",
          connection_topic_id: CONNECTION,
          operator_id: "0.0.301@0.0.300",
        }),
        // Duplicate records of the same connection are shown once.
        message(OUTBOUND, AGENT, {
          p: "hcs-10",
          op: "connection_created",
          connection_topic_id: CONNECTION,
          operator_id: "0.0.301@0.0.300",
        }),
        message(OUTBOUND, AGENT, { p: "hcs-10", op: "connection_request", operator_id: "0.0.401@0.0.400" }),
      ],
    },
    [`/topics/${CONNECTION}/messages?limit=50&order=desc`]: {
      messages: [
        message(CONNECTION, AGENT, { p: "hcs-10", op: "message", data: decisionData("OLD") }),
        // The peer can write to the shared topic too; it must not be shown as the agent's decision.
        message(CONNECTION, "0.0.300", { p: "hcs-10", op: "message", data: decisionData("SPOOFED") }),
        message(CONNECTION, AGENT, { p: "hcs-10", op: "message", data: "plain chat, not a decision" }),
        message(CONNECTION, AGENT, { p: "hcs-10", op: "message", data: decisionData("NEW") }),
      ],
    },
  };
  return new MirrorClient(BASE, async url => {
    const body = routes[url.replace(`${BASE}/api/v1`, "")];
    return body === undefined ? new Response("{}", { status: 404 }) : Response.json(body);
  });
}

describe("readPassport", () => {
  it("assembles identity, channels, registration and decisions from the Mirror Node alone", async () => {
    const view = (await readPassport(fakeNetwork(), "testnet", AGENT, REGISTRY))!;

    expect(view.profile).toMatchObject({
      displayName: "Test Agent",
      capabilities: ["MARKET_INTELLIGENCE", "MULTI_AGENT_COORDINATION"],
      inboundTopicId: INBOUND,
    });
    expect(view.inbound?.verified).toBe(true);
    expect(view.outbound?.verified).toBe(true);
    expect(view.registration?.registryTopicId).toBe(REGISTRY);
    expect(view.connections).toEqual([
      expect.objectContaining({ connectionTopicId: CONNECTION, peerAccountId: "0.0.300" }),
    ]);
    expect(view.decisions.map(d => d.decision.action)).toEqual(["NEW", "OLD"]);
  });

  it("flags an inbound topic whose memo names a different owner", async () => {
    const view = (await readPassport(fakeNetwork({ inboundMemo: "hcs-10:0:60:0:0.0.666" }), "testnet", AGENT))!;
    expect(view.inbound?.verified).toBe(false);
  });

  it("refuses a profile whose content does not match its HCS-1 hash", async () => {
    const view = (await readPassport(fakeNetwork({ profileBytes: Buffer.from("{}") }), "testnet", AGENT))!;
    expect(view.profile).toBeNull();
    expect(view.profileError).toMatch(/does not match/);
  });

  it("returns null for an account that does not exist", async () => {
    expect(await readPassport(fakeNetwork(), "testnet", "0.0.404")).toBeNull();
  });
});
