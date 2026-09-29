import { PrivateKey } from "@hashgraph/sdk";
import { describe, expect, it } from "vitest";
import { loadNetworkConfig, loadOperatorConfig, parsePrivateKey } from "../src/config";
import { PassportError } from "../src/errors";

// Keys are generated per run so no key material ever lives in the repo.
const ed25519 = PrivateKey.generateED25519();
const ecdsa = PrivateKey.generateECDSA();

const baseEnv = { HEDERA_OPERATOR_ID: "0.0.1234", HEDERA_OPERATOR_KEY: ed25519.toStringDer() };

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return error instanceof PassportError ? error.code : "NOT_A_PASSPORT_ERROR";
  }
  return undefined;
}

describe("loadOperatorConfig", () => {
  it("defaults to testnet with the public testnet Mirror Node", () => {
    const cfg = loadOperatorConfig(baseEnv);
    expect(cfg.network).toBe("testnet");
    expect(cfg.mirrorNodeUrl).toBe("https://testnet.mirrornode.hedera.com");
    expect(cfg.initialBalanceHbar).toBe(5);
  });

  it("reports missing credentials, not a parse error", () => {
    expect(codeOf(() => loadOperatorConfig({}))).toBe("MISSING_CREDENTIALS");
    expect(codeOf(() => loadOperatorConfig({ HEDERA_OPERATOR_ID: "0.0.1" }))).toBe("MISSING_CREDENTIALS");
    expect(codeOf(() => loadOperatorConfig({ ...baseEnv, HEDERA_OPERATOR_KEY: "   " }))).toBe("MISSING_CREDENTIALS");
  });

  it("rejects networks other than testnet and mainnet", () => {
    expect(codeOf(() => loadOperatorConfig({ ...baseEnv, HEDERA_NETWORK: "previewnet" }))).toBe("WRONG_NETWORK");
    expect(loadOperatorConfig({ ...baseEnv, HEDERA_NETWORK: " Mainnet " }).network).toBe("mainnet");
  });

  it("validates entity IDs", () => {
    expect(codeOf(() => loadOperatorConfig({ ...baseEnv, HEDERA_OPERATOR_ID: "1234" }))).toBe("INVALID_CONFIG");
    expect(codeOf(() => loadOperatorConfig({ ...baseEnv, HCS10_REGISTRY_TOPIC_ID: "topic" }))).toBe("INVALID_CONFIG");
    expect(loadOperatorConfig({ ...baseEnv, HCS10_REGISTRY_TOPIC_ID: "0.0.99" }).registryTopicId).toBe("0.0.99");
  });

  it("bounds the per-passport funding", () => {
    for (const bad of ["0", "-1", "abc", "101"]) {
      expect(codeOf(() => loadOperatorConfig({ ...baseEnv, AGENT_INITIAL_BALANCE_HBAR: bad }))).toBe("INVALID_CONFIG");
    }
    expect(loadOperatorConfig({ ...baseEnv, AGENT_INITIAL_BALANCE_HBAR: "2.5" }).initialBalanceHbar).toBe(2.5);
  });

  it("treats empty optional values as unset, as they appear in .env.example", () => {
    const cfg = loadOperatorConfig({ ...baseEnv, AGENT_NAME: "", MIRROR_NODE_URL: "", HEDERA_OPERATOR_KEY_TYPE: "" });
    expect(cfg.agent.name).toBe("Passport Demo Agent");
    expect(cfg.mirrorNodeUrl).toBe("https://testnet.mirrornode.hedera.com");
  });
});

describe("loadNetworkConfig", () => {
  it("strips trailing slashes from a custom Mirror Node", () => {
    expect(loadNetworkConfig({ MIRROR_NODE_URL: "https://mirror.example//" }).mirrorNodeUrl).toBe(
      "https://mirror.example",
    );
  });
});

describe("parsePrivateKey", () => {
  it("detects the curve of DER keys", () => {
    expect(parsePrivateKey(ed25519.toStringDer()).keyType).toBe("ed25519");
    expect(parsePrivateKey(ecdsa.toStringDer()).keyType).toBe("ecdsa");
  });

  it("reads 0x-prefixed raw hex as ECDSA, as the Hedera Portal shows it", () => {
    const parsed = parsePrivateKey(`0x${ecdsa.toStringRaw()}`);
    expect(parsed).toEqual({ der: ecdsa.toStringDer(), keyType: "ecdsa" });
  });

  it("requires a declared type for bare raw hex, which is ambiguous", () => {
    expect(codeOf(() => parsePrivateKey(ed25519.toStringRaw()))).toBe("INVALID_CONFIG");
    expect(parsePrivateKey(ed25519.toStringRaw(), "ed25519").der).toBe(ed25519.toStringDer());
    expect(codeOf(() => parsePrivateKey(ed25519.toStringRaw(), "rsa"))).toBe("INVALID_CONFIG");
  });

  it("does not echo the key in its error message", () => {
    try {
      parsePrivateKey("not-a-key-but-secret-looking");
    } catch (error) {
      expect((error as Error).message).not.toContain("secret-looking");
    }
  });
});
