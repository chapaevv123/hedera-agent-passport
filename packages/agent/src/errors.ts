/**
 * Every failure a developer can hit on the happy path has a code and a
 * concrete next step. The CLI prints `hint`; the API returns both.
 */
export type PassportErrorCode =
  | "MISSING_CREDENTIALS"
  | "INVALID_CONFIG"
  | "WRONG_NETWORK"
  | "CLOCK_SKEW"
  | "KEY_MISMATCH"
  | "INSUFFICIENT_BALANCE"
  | "NOT_REGISTERED"
  | "TOPIC_NOT_READY"
  | "MIRROR_LAG"
  | "MIRROR_UNAVAILABLE"
  | "PROFILE_INSCRIPTION_FAILED"
  | "REGISTRATION_FAILED"
  | "CONNECTION_TIMEOUT"
  | "PAYLOAD_TOO_LARGE"
  | "INPUT_UNAVAILABLE"
  | "SUBMIT_FAILED";

export class PassportError extends Error {
  constructor(
    readonly code: PassportErrorCode,
    message: string,
    readonly hint: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "PassportError";
  }
}

/** Hedera response codes that map to a more specific, actionable error. */
const STATUS_RULES: Array<{ statuses: string[]; code: PassportErrorCode; hint: string }> = [
  {
    statuses: ["INSUFFICIENT_PAYER_BALANCE", "INSUFFICIENT_ACCOUNT_BALANCE", "INSUFFICIENT_TX_FEE"],
    code: "INSUFFICIENT_BALANCE",
    hint: "Fund the paying account with testnet HBAR at https://portal.hedera.com/faucet and retry.",
  },
  {
    statuses: ["INVALID_SIGNATURE", "KEY_PREFIX_MISMATCH"],
    code: "KEY_MISMATCH",
    hint: "HEDERA_OPERATOR_KEY does not belong to HEDERA_OPERATOR_ID. Copy both from the same account in the Hedera Portal.",
  },
  {
    statuses: ["INVALID_ACCOUNT_ID", "PAYER_ACCOUNT_NOT_FOUND", "ACCOUNT_DELETED"],
    code: "WRONG_NETWORK",
    hint: "The account does not exist on this network. Check HEDERA_NETWORK matches where the account was created.",
  },
  {
    statuses: ["INVALID_TRANSACTION_START", "TRANSACTION_EXPIRED"],
    code: "CLOCK_SKEW",
    hint: "Your system clock differs from network time. Sync it (Windows: Settings → Time & language → Sync now; Linux/macOS: enable NTP) and retry.",
  },
  {
    statuses: ["INVALID_TOPIC_ID", "TOPIC_EXPIRED"],
    code: "TOPIC_NOT_READY",
    hint: "The topic is unknown to the network. Re-run `npm run agent:register` if the passport state is stale.",
  },
];

function statusOf(error: unknown): string | undefined {
  if (error && typeof error === "object" && "status" in error) {
    const status = (error as { status: unknown }).status;
    if (status !== undefined && status !== null) return String(status);
  }
  return undefined;
}

/**
 * Converts an error thrown by the Hedera SDK (or by standards-sdk, which
 * rethrows them) into a PassportError. `action` describes what was being
 * attempted, e.g. "create the agent account".
 */
export function classifyHederaError(error: unknown, action: string): PassportError {
  if (error instanceof PassportError) return error;

  const message = error instanceof Error ? error.message : String(error);
  const status = statusOf(error);
  const haystack = `${status ?? ""} ${message}`;

  for (const rule of STATUS_RULES) {
    const hit = rule.statuses.find(s => haystack.includes(s));
    if (hit) {
      return new PassportError(rule.code, `Could not ${action}: ${hit}`, rule.hint, { cause: error });
    }
  }

  return new PassportError(
    "SUBMIT_FAILED",
    `Could not ${action}: ${message}`,
    status
      ? `The network rejected the transaction with ${status}; see https://docs.hedera.com for the response code.`
      : "The failure came from the SDK before a transaction was accepted; the message above has the detail.",
    { cause: error },
  );
}
