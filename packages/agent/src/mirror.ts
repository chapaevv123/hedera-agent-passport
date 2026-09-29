import { PassportError } from "./errors";

/** A topic message as read back from the Mirror Node, with its content decoded. */
export interface TopicMessage {
  topicId: string;
  sequenceNumber: number;
  /** "seconds.nanos" — Hedera consensus time, the authoritative timestamp. */
  consensusTimestamp: string;
  payerAccountId: string;
  /** "0.0.x@seconds.nanos", when the Mirror Node reports it. */
  transactionId?: string;
  contents: string;
}

export interface MirrorAccount {
  accountId: string;
  memo: string;
  balanceTinybar: number;
}

export interface MirrorTopic {
  topicId: string;
  memo: string;
}

export interface ExchangeRate {
  /** US cents per `hbarEquivalent` HBAR. */
  centEquivalent: number;
  hbarEquivalent: number;
  /** Consensus timestamp of the file update that set this rate. */
  timestamp: string;
  expirationTime: number;
}

interface RawTopicMessage {
  topic_id: string;
  sequence_number: number;
  consensus_timestamp: string;
  payer_account_id: string;
  message: string;
  chunk_info?: {
    initial_transaction_id?: { account_id: string; transaction_valid_start: string } | null;
  } | null;
}

function decodeTopicMessage(raw: RawTopicMessage): TopicMessage {
  const txId = raw.chunk_info?.initial_transaction_id;
  return {
    topicId: raw.topic_id,
    sequenceNumber: raw.sequence_number,
    consensusTimestamp: raw.consensus_timestamp,
    payerAccountId: raw.payer_account_id,
    transactionId: txId ? `${txId.account_id}@${txId.transaction_valid_start}` : undefined,
    contents: Buffer.from(raw.message, "base64").toString("utf8"),
  };
}

type Fetch = (url: string) => Promise<Response>;

/**
 * Read-only Mirror Node client. Everything the UI shows about an agent comes
 * through here, so the network — not local state — is the source of truth.
 */
export class MirrorClient {
  constructor(
    readonly baseUrl: string,
    private readonly fetchImpl: Fetch = url => fetch(url),
  ) {}

  /** Returns `null` for 404 so callers can tell "not there yet" from "broken". */
  private async get<T>(path: string): Promise<T | null> {
    const url = `${this.baseUrl}/api/v1${path}`;
    let response: Response;
    try {
      response = await this.fetchImpl(url);
    } catch (error) {
      throw new PassportError(
        "MIRROR_UNAVAILABLE",
        `Mirror Node request failed: ${url}`,
        "Check your internet connection, or set MIRROR_NODE_URL to another Mirror Node.",
        { cause: error },
      );
    }
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new PassportError(
        "MIRROR_UNAVAILABLE",
        `Mirror Node answered ${response.status} for ${url}`,
        "The Mirror Node is degraded; retry in a minute.",
      );
    }
    return (await response.json()) as T;
  }

  /**
   * Seconds to add to the local clock to match network time, from the Mirror
   * Node's HTTP Date header (1s resolution, so the midpoint is used).
   */
  async clockDriftSeconds(): Promise<number> {
    const url = `${this.baseUrl}/api/v1/network/exchangerate`;
    let response: Response;
    try {
      response = await this.fetchImpl(url);
    } catch (error) {
      throw new PassportError("MIRROR_UNAVAILABLE", `Mirror Node request failed: ${url}`, "Check your connection.", {
        cause: error,
      });
    }
    const serverDate = Date.parse(response.headers.get("date") ?? "");
    if (Number.isNaN(serverDate)) return 0;
    return Math.round((serverDate + 500 - Date.now()) / 1000);
  }

  async getAccount(accountId: string): Promise<MirrorAccount | null> {
    const raw = await this.get<{ account: string; memo: string; balance: { balance: number } }>(
      `/accounts/${accountId}?transactions=false`,
    );
    return raw && { accountId: raw.account, memo: raw.memo, balanceTinybar: raw.balance.balance };
  }

  async getTopic(topicId: string): Promise<MirrorTopic | null> {
    const raw = await this.get<{ topic_id: string; memo: string }>(`/topics/${topicId}`);
    return raw && { topicId: raw.topic_id, memo: raw.memo };
  }

  async getTopicMessage(topicId: string, sequenceNumber: number): Promise<TopicMessage | null> {
    const raw = await this.get<RawTopicMessage>(`/topics/${topicId}/messages/${sequenceNumber}`);
    return raw && decodeTopicMessage(raw);
  }

  /**
   * Newest first by default, which is what a timeline wants. `before` / `after`
   * restrict to sequence numbers strictly below / above, for paging and polling.
   */
  async listTopicMessages(
    topicId: string,
    {
      limit = 50,
      order = "desc",
      before,
      after,
    }: { limit?: number; order?: "asc" | "desc"; before?: number; after?: number } = {},
  ): Promise<TopicMessage[]> {
    let path = `/topics/${topicId}/messages?limit=${limit}&order=${order}`;
    if (before !== undefined) path += `&sequencenumber=lt:${before}`;
    if (after !== undefined) path += `&sequencenumber=gt:${after}`;
    const raw = await this.get<{ messages: RawTopicMessage[] }>(path);
    return (raw?.messages ?? []).map(decodeTopicMessage);
  }

  async getExchangeRate(): Promise<ExchangeRate> {
    const raw = await this.get<{
      current_rate: { cent_equivalent: number; hbar_equivalent: number; expiration_time: number };
      timestamp: string;
    }>("/network/exchangerate");
    if (!raw) {
      throw new PassportError(
        "INPUT_UNAVAILABLE",
        "The Mirror Node returned no exchange rate.",
        "Retry shortly; the rate is published hourly by the network.",
      );
    }
    return {
      centEquivalent: raw.current_rate.cent_equivalent,
      hbarEquivalent: raw.current_rate.hbar_equivalent,
      expirationTime: raw.current_rate.expiration_time,
      timestamp: raw.timestamp,
    };
  }

  /**
   * Consensus is final in seconds, but the Mirror Node ingests it a few
   * seconds later. Poll until the message is readable or give up with
   * MIRROR_LAG — the transaction itself has already succeeded at that point.
   */
  async waitForTopicMessage(
    topicId: string,
    sequenceNumber: number,
    { timeoutMs = 30_000, intervalMs = 1_500 }: { timeoutMs?: number; intervalMs?: number } = {},
  ): Promise<TopicMessage> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const message = await this.getTopicMessage(topicId, sequenceNumber);
      if (message) return message;
      if (Date.now() + intervalMs > deadline) {
        throw new PassportError(
          "MIRROR_LAG",
          `Topic ${topicId} message #${sequenceNumber} reached consensus but is not on the Mirror Node after ${timeoutMs / 1000}s.`,
          "The message is not lost. Refresh in a few seconds, or open the topic on Hashscan.",
        );
      }
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
  }
}
