# Phase 1 go / no-go gate

**Result: GO** (2026-09-29, Hedera testnet)

Every item below was produced by `npm run agent:register` and `npm run agent:act` against testnet and checked with raw Mirror Node queries, not with this repo's own code.

| Critical item           | Status | Evidence                                                                                                                                                                                                                                                                                 |
| ----------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Template structure      | PASS   | npm workspaces `packages/agent` + `packages/nextjs`, `solidityFramework: none` layout as in the official `hedera-demo` template                                                                                                                                                          |
| Dependencies install    | PASS   | `npm install` clean (Node 22)                                                                                                                                                                                                                                                            |
| HCS-10 SDK integrated   | PASS   | `@hashgraphonline/standards-sdk@0.1.187`: `createAccount`, `createInboundTopic`, `buildHcs10CreateOutboundTopicTx`, `createRegistryTopic`, `registerAgent`, `submitConnectionRequest`, `handleConnectionRequest`, `waitForConnectionConfirmation`, `sendMessage`, HCS-11 profile builder |
| Testnet operator works  | PASS   | owner-supplied ECDSA testnet account                                                                                                                                                                                                                                                     |
| Real agent registration | PASS   | registry topic `0.0.10775907` seq 1 (`op: register`, account `0.0.10775908`)                                                                                                                                                                                                             |
| Real transaction IDs    | PASS   | e.g. decision `0.0.10775908@1790682527.960087558`                                                                                                                                                                                                                                        |
| Visible on Mirror Node  | PASS   | see links below                                                                                                                                                                                                                                                                          |
| No secrets committed    | PASS   | nothing committed; `.env` and `.passport/` are git-ignored (`git check-ignore` verified)                                                                                                                                                                                                 |

## Proof links

- Agent account: https://hashscan.io/testnet/account/0.0.10775908
- Registry entries: https://testnet.mirrornode.hedera.com/api/v1/topics/0.0.10775907/messages
- HCS-11 profile (HCS-1 file, resolved by Kiloscribe's CDN as an independent reader): https://kiloscribe.com/api/inscription-cdn/0.0.10776001?network=testnet
- Handshake on the agent's inbound topic (`connection_request` → `connection_created`): https://testnet.mirrornode.hedera.com/api/v1/topics/0.0.10775910/messages
- Connection topic (memo `hcs-10:1:60:2:0.0.10775910:1`): https://hashscan.io/testnet/topic/0.0.10776024
- Decision #1, `BASELINE`: https://testnet.mirrornode.hedera.com/api/v1/topics/0.0.10776024/messages/1
- Decision #2, `HOLD` (derived from #1 read back from the chain): https://testnet.mirrornode.hedera.com/api/v1/topics/0.0.10776024/messages/2

## Blockers found and resolved

1. **The SDK's default registry is dead.** `createAndRegisterAgent` posts to `moonscape.tech/api/request-register`, which answers 405. Agents are instead registered on-chain with the SDK's `createRegistryTopic` + `registerAgent` (an HCS-2 registry topic, as the HCS-10 spec defines it).
2. **Kiloscribe inscription service login is broken.** The bundled `@kiloscribe/inscription-sdk@2.0.10-canary.9` signs the challenge object instead of its JSON, so it always gets 401. Signing the JSON string by hand got a 200, which confirmed the cause.
3. **Kiloscribe testnet processing stalled.** Even with a valid key, job `0.0.2659396-1790682204-223292950` was paid (1.34 HBAR) but stayed `processing` with no topic. Profiles are now written as HCS-1 files directly on Hedera (`src/hcs1.ts`, per the HCS-1 spec). Kiloscribe's own CDN decodes them correctly, so they interoperate with the rest of the ecosystem. Registration now depends on nothing but Hedera.
4. **Local clock 14–15s ahead of network time** → `INVALID_TRANSACTION_START`. Drift is measured against the Mirror Node's `Date` header and applied through the Hedera SDK's `Cache.setTimeDrift`.
5. **Mirror Node lag after the memo update** broke the SDK's profile lookup during the handshake. `connect()` now waits until both memos are indexed.
6. **The CLI never exited** because the Hedera client's gRPC channels stayed open. Commands now exit explicitly.

## Residual risk

- The SDK's _reads_ of profiles (`retrieveProfile`, used inside the handshake) still go through Kiloscribe's CDN. It works today; if it goes down, opening _new_ connections fails with a clear error. Existing passports, decisions and the UI are unaffected, because the UI decodes HCS-1 profiles from the Mirror Node itself.
- Node ≥ 22.15 is required (built-in zstd for HCS-1). Node 20 has been end-of-life since April 2026.
