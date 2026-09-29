# Rubric red team

A hostile Hedera DevRel judge, scoring the candidate as of 2026-09-29. Scores are deliberately not inflated.

## Ecosystem integration and value: 35

**Is HCS-10 structurally required?** Yes. Identity = HCS-11 profile via account memo; address = HCS-10 inbound topic; log = HCS-10 connection topic; the UI discovers decisions only by following HCS-10 records. There is no database. Deleting the standard deletes the product.

**Real SDK calls?** Yes: `createAccount`, `createInboundTopic`, `buildHcs10CreateOutboundTopicTx`, `createRegistryTopic`, `registerAgent`, `submitConnectionRequest`, `handleConnectionRequest`, `waitForConnectionConfirmation`, `sendMessage`, `HCS11Client.createAIAgentProfile/validateProfile/updateAccountMemoWithProfile`.

Weaknesses a judge will raise:

1. **HCS-10 is not on the bounty's example list** (DEXes, oracles, bridges, lending, storage). The list is "illustrative", but a judge anchored on it may not count Hashgraph Online as an "ecosystem integration". _Unfixable without diluting focus; the README states the value case up front._
2. **The template bypasses the SDK's headline call** `createAndRegisterAgent` and its profile inscription. That's justified (dead endpoint, broken service, documented with evidence), but a judge may read "wrapper around workarounds". _Mitigated by the design notes and the gate report._
3. **The agent cannot accept connections by itself.** Only the template's own peer ever connects, through a script that holds both keys. For something pitched at "agent-to-agent systems", an agent that nobody else can reach is a real gap. **→ Fix: `agent:listen`.**
4. **Registry is private by default.** No public HCS-10 testnet registry exists (the SDK's known topic is a mainnet HCS-20 registry; the hosted one is dead), so discoverability is limited to people who share a registry topic. _Documented; `HCS10_REGISTRY_TOPIC_ID` supports shared registries._
5. The demo skill is simple (a threshold on an hourly rate), so most decisions are `HOLD`. _Acceptable: the product is the plumbing, and the README says so._

Score now: **27/35**. With (3) fixed: ~30.

## Documentation: 30

- Stranger can build it: quickstart, prerequisites (including the git-identity and Node 22.15 traps the CLI hits), expected output, measured cost and time. ✔
- All env vars explained in one table with defaults and failure behaviour. ✔
- AGENTS.md is distinct: invariants, traps, definition of done. ✔
- Judge can verify a real transaction: proof table at the top, `curl` + `jq` recipes, Hashscan walkthrough, `check:eligibility` re-verifies on-chain. ✔

Weaknesses:

1. **No screenshot of the UI.** A judge skimming GitHub sees no picture of the product. _Owner action: capture one during the demo recording._
2. **Hashscan deep links not visually verified.** Hashscan returns HTTP 404 plus an SPA shell for every deep link, so they can't be checked automatically. The URL formats follow Hashscan's routes (`/testnet/transaction/<consensus timestamp>`). _Owner action: click three links once._
3. The README is long (~390 lines). Its order puts proof, then value, then quickstart, so a skimmer still gets the point.

Score: **26/30**.

## Code quality: 20

- TypeScript strict, `noUncheckedIndexedAccess`; no `any` in source.
- Typed errors with fixes for every failure listed in the brief, plus clock skew, which was found in real testing.
- 60 meaningful tests: interpretation logic with faked Mirror Node responses, spoofing and tampering cases, codec round trips. Writes are proven on testnet, not mocked.
- Resumable registration, persisted before every paid step.

Weaknesses:

1. `standards-sdk` logs its own WARN/ERROR lines to the console (e.g. on Mirror Node lag) that the template does not control.
2. No automated testnet integration test in CI (by design: it needs a funded key). The manual path is documented and `check:eligibility` re-verifies the recorded proof.
3. `performAction` reads up to 25 recent messages to recover the previous decision. On a busy shared connection topic, the previous decision could fall out of that window, which would produce a spurious `BASELINE`.
4. The `/api/agent/act` route has no auth (documented as a local-only dev server).

Score: **17/20**.

## Hedera service depth: 15

- Consensus Service used in depth: five topic roles (registry, inbound, outbound, connection, HCS-1 file), topic memos per spec, submit keys (public, owner-only, 1-of-2 threshold), no-admin-key immutable files, chunked HCS-1 writes.
- Crypto Service: account creation per agent, account memo as an identity pointer.
- Four HOL standards composed: HCS-1, HCS-2 (registry), HCS-10, HCS-11.
- Real consensus timestamps and Mirror Node verification throughout, including hash-verified profile reassembly.

Weaknesses: one Hedera _service family_ (HCS) does almost all the work. No HTS, no scheduled transactions, no contracts. _By design; the rubric allows "one used with real depth"._

Score: **13/15**.

## Total: 83/100 → ~86 after fixing ecosystem weakness 3

## Fix list, highest value first

1. **`agent:listen`**: accept inbound `connection_request`s from any HCS-10 agent and answer `message`s on connections with a fresh decision. Proves the agent is reachable, not just loggable. _(Ecosystem +3, Depth +1)_
2. **Previous-decision lookup** should page until it finds the skill's last decision, not stop at 25 messages. _(Correctness)_
3. Owner: screenshot, and click-check three Hashscan links. _(Docs +2)_

## Fixes applied (same day)

| #   | Weakness                                                 | Fix                                                                                                                                                                                                                                               | Evidence                                                                                                                                                                                                                                    |
| --- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Agent unreachable by other agents                        | `agent:listen` (`src/listen.ts`): accepts `connection_request`s from any HCS-10 agent and answers peer messages with a decision. What is pending is derived from the chain, so restarts are safe; spoofed requests are ignored. 6 new unit tests. | An independent agent using only raw `standards-sdk` connected, asked, and got a decision: connection `0.0.10777060`, messages #1 (question, paid by `0.0.10776869`) and #2 (answer, paid by the agent). Re-verified by `check:eligibility`. |
| 2   | Previous decision could fall outside a 25-message window | `latestDecision` pages backwards 100 at a time (up to 1,000 messages)                                                                                                                                                                             | Unit-tested paths; live `agent:act` still returns `HOLD` from on-chain memory                                                                                                                                                               |
| 3   | Screenshot, Hashscan click-check                         | **Owner action** (no browser available to the builder)                                                                                                                                                                                            | —                                                                                                                                                                                                                                           |

Newly introduced risk: `agent:listen` spends the agent's HBAR on behalf of anyone who contacts it. This is documented in the README and SECURITY_SCRUB, with the HCS-10 fee-based inbound topic (HIP-991) as the production answer.

**Rescored: Ecosystem 30/35 · Docs 26/30 (28 with a screenshot) · Code 18/20 · Depth 14/15 = 88/100.** The largest remaining risk is not technical: judges anchored on the DEX/oracle/bridge example list may discount HCS-10 as an "ecosystem integration".
