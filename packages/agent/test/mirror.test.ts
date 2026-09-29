import { describe, expect, it } from "vitest";
import { PassportError } from "../src/errors";
import { MirrorClient } from "../src/mirror";
import { consensusToIso, verificationFor } from "../src/verify";

const BASE = "https://mirror.test";

/** A fake Mirror Node answering from a route table; unknown routes are 404, like the real one. */
function mirrorWith(routes: Record<string, unknown | (() => Response)>) {
  const calls: string[] = [];
  const client = new MirrorClient(BASE, async url => {
    calls.push(url);
    const route = routes[url.replace(`${BASE}/api/v1`, "")];
    if (typeof route === "function") return (route as () => Response)();
    return route === undefined ? new Response("{}", { status: 404 }) : Response.json(route);
  });
  return { client, calls };
}

const rawMessage = (sequence: number, text: string) => ({
  topic_id: "0.0.500",
  sequence_number: sequence,
  consensus_timestamp: "1790682555.240203297",
  payer_account_id: "0.0.42",
  message: Buffer.from(text).toString("base64"),
  chunk_info: { initial_transaction_id: { account_id: "0.0.42", transaction_valid_start: "1790682527.960087558" } },
});

describe("MirrorClient", () => {
  it("decodes topic messages and rebuilds the transaction ID", async () => {
    const { client } = mirrorWith({ "/topics/0.0.500/messages/1": rawMessage(1, '{"p":"hcs-10"}') });
    expect(await client.getTopicMessage("0.0.500", 1)).toEqual({
      topicId: "0.0.500",
      sequenceNumber: 1,
      consensusTimestamp: "1790682555.240203297",
      payerAccountId: "0.0.42",
      transactionId: "0.0.42@1790682527.960087558",
      contents: '{"p":"hcs-10"}',
    });
  });

  it("maps 404 to null so callers can tell 'not indexed yet' from failure", async () => {
    const { client } = mirrorWith({});
    expect(await client.getAccount("0.0.1")).toBeNull();
    expect(await client.getTopicMessage("0.0.500", 9)).toBeNull();
  });

  it("reports server errors and network failures as MIRROR_UNAVAILABLE", async () => {
    const down = mirrorWith({ "/accounts/0.0.1?transactions=false": () => new Response("", { status: 503 }) });
    await expect(down.client.getAccount("0.0.1")).rejects.toMatchObject({ code: "MIRROR_UNAVAILABLE" });

    const offline = new MirrorClient(BASE, async () => {
      throw new TypeError("fetch failed");
    });
    await expect(offline.getTopic("0.0.1")).rejects.toMatchObject({ code: "MIRROR_UNAVAILABLE" });
  });

  it("waits out Mirror Node lag, then returns the message", async () => {
    let polls = 0;
    const client = new MirrorClient(BASE, async () =>
      ++polls < 3 ? new Response("{}", { status: 404 }) : Response.json(rawMessage(7, "late")),
    );
    const message = await client.waitForTopicMessage("0.0.500", 7, { timeoutMs: 1000, intervalMs: 1 });
    expect(message.contents).toBe("late");
    expect(polls).toBe(3);
  });

  it("gives up with MIRROR_LAG, not a generic error", async () => {
    const { client } = mirrorWith({});
    const error = await client.waitForTopicMessage("0.0.500", 7, { timeoutMs: 20, intervalMs: 5 }).catch(e => e);
    expect(error).toBeInstanceOf(PassportError);
    expect(error.code).toBe("MIRROR_LAG");
  });

  it("measures clock drift from the Date header", async () => {
    const serverNow = Date.now() - 15_000;
    const client = new MirrorClient(
      BASE,
      async () => new Response("{}", { headers: { date: new Date(serverNow).toUTCString() } }),
    );
    const drift = await client.clockDriftSeconds();
    expect(drift).toBeGreaterThanOrEqual(-16);
    expect(drift).toBeLessThanOrEqual(-14);
  });

  it("reads the network exchange rate", async () => {
    const { client } = mirrorWith({
      "/network/exchangerate": {
        current_rate: { cent_equivalent: 231199, hbar_equivalent: 30000, expiration_time: 1789491600 },
        timestamp: "1789488065.280160388",
      },
    });
    expect(await client.getExchangeRate()).toMatchObject({ centEquivalent: 231199, hbarEquivalent: 30000 });
  });
});

describe("verification metadata", () => {
  it("links a message to Hashscan by consensus timestamp and to its raw Mirror Node record", async () => {
    const { client } = mirrorWith({ "/topics/0.0.500/messages/1": rawMessage(1, "x") });
    const message = (await client.getTopicMessage("0.0.500", 1))!;
    expect(verificationFor("testnet", BASE, message)).toEqual({
      topicId: "0.0.500",
      sequenceNumber: 1,
      consensusTimestamp: "1790682555.240203297",
      transactionId: "0.0.42@1790682527.960087558",
      hashscanUrl: "https://hashscan.io/testnet/transaction/1790682555.240203297",
      mirrorUrl: `${BASE}/api/v1/topics/0.0.500/messages/1`,
    });
  });

  it("converts consensus timestamps without losing sub-second precision", () => {
    expect(consensusToIso("1790682555.240203297")).toBe("2026-09-29T11:49:15.240Z");
    expect(consensusToIso("1790682555")).toBe("2026-09-29T11:49:15.000Z");
  });
});
