import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readState, requireConnectedState, writeState, type PassportState } from "../src/state";

const tempFile = () => join(mkdtempSync(join(tmpdir(), "passport-")), "state.json");

const identity = (n: number) => ({
  accountId: `0.0.${n}`,
  privateKey: "unused-in-this-test",
  inboundTopicId: `0.0.${n + 1}`,
  outboundTopicId: `0.0.${n + 2}`,
  profileTopicId: `0.0.${n + 3}`,
  registered: true,
});

const connected: PassportState = {
  version: 1,
  network: "testnet",
  registryTopicId: "0.0.1",
  agent: identity(10),
  peer: identity(20),
  connectionTopicId: "0.0.30",
};

describe("passport state", () => {
  it("returns null when registration has never run", () => {
    expect(readState(tempFile())).toBeNull();
  });

  it("round-trips and creates the directory", () => {
    const path = tempFile().replace("state.json", join("nested", "state.json"));
    writeState(path, connected);
    expect(readState(path)).toEqual(connected);
  });

  it.skipIf(process.platform === "win32")("is written owner-readable only, since it holds private keys", () => {
    const path = tempFile();
    writeState(path, connected);
    expect(statSync(path).mode & 0o077).toBe(0);
  });

  it("rejects a corrupted file with a fix, rather than acting on it", () => {
    const path = tempFile();
    writeFileSync(path, JSON.stringify({ version: 2, network: "testnet" }));
    expect(() => readState(path)).toThrow(expect.objectContaining({ code: "INVALID_CONFIG" }));
  });

  it("accepts partial state so an interrupted registration can resume", () => {
    const path = tempFile();
    const partial: PassportState = { version: 1, network: "testnet", agent: { accountId: "0.0.5", privateKey: "k" } };
    writeState(path, partial);
    expect(JSON.parse(readFileSync(path, "utf8")).agent.accountId).toBe("0.0.5");
    expect(() => requireConnectedState(readState(path))).toThrow(expect.objectContaining({ code: "NOT_REGISTERED" }));
  });

  it("only treats fully registered and connected passports as ready to act", () => {
    expect(requireConnectedState(connected).connectionTopicId).toBe("0.0.30");
    expect(() => requireConnectedState(null)).toThrow(expect.objectContaining({ code: "NOT_REGISTERED" }));
    const unregisteredPeer = { ...connected, peer: { ...identity(20), registered: false } };
    expect(() => requireConnectedState(unregisteredPeer)).toThrow(expect.objectContaining({ code: "NOT_REGISTERED" }));
  });
});
