import type { Network } from "./config";
import type { TopicMessage } from "./mirror";

/**
 * Everything a third party needs to check a message without trusting this app:
 * the consensus timestamp plus one Hashscan and one raw Mirror Node URL.
 */
export interface Verification {
  topicId: string;
  sequenceNumber: number;
  consensusTimestamp: string;
  transactionId?: string;
  hashscanUrl: string;
  mirrorUrl: string;
}

export function hashscanAccountUrl(network: Network, accountId: string): string {
  return `https://hashscan.io/${network}/account/${accountId}`;
}

export function hashscanTopicUrl(network: Network, topicId: string): string {
  return `https://hashscan.io/${network}/topic/${topicId}`;
}

/** Hashscan resolves a transaction by its consensus timestamp. */
function hashscanTransactionUrl(network: Network, consensusTimestamp: string): string {
  return `https://hashscan.io/${network}/transaction/${consensusTimestamp}`;
}

function mirrorTopicMessageUrl(mirrorNodeUrl: string, topicId: string, sequenceNumber: number): string {
  return `${mirrorNodeUrl}/api/v1/topics/${topicId}/messages/${sequenceNumber}`;
}

export function verificationFor(network: Network, mirrorNodeUrl: string, message: TopicMessage): Verification {
  return {
    topicId: message.topicId,
    sequenceNumber: message.sequenceNumber,
    consensusTimestamp: message.consensusTimestamp,
    transactionId: message.transactionId,
    hashscanUrl: hashscanTransactionUrl(network, message.consensusTimestamp),
    mirrorUrl: mirrorTopicMessageUrl(mirrorNodeUrl, message.topicId, message.sequenceNumber),
  };
}

/** "1727600000.123456789" → ISO string, for display only. */
export function consensusToIso(consensusTimestamp: string): string {
  const [seconds, nanos = "0"] = consensusTimestamp.split(".");
  const millis = Number(seconds) * 1000 + Math.floor(Number(nanos.padEnd(9, "0")) / 1e6);
  return new Date(millis).toISOString();
}
