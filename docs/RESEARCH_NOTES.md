# Research notes

Verified 2026-09-29 against primary sources. Anything here that turns out to be wrong should be corrected, not worked around.

## Bounty (hedera.com/blog/scaffold-hbar-template-bounty)

- Build window 2026-09-21 → submissions close **2026-10-04 23:59 ET**. Five equal $2,000 prizes.
- Eligibility gate (all mechanical, all fatal):
  1. scaffolds via `npm create scaffold-hbar@latest --template owner/repo`
  2. `template.json` present and valid
  3. `README.md` and `AGENTS.md` present
  4. install, lint, build pass from a fresh scaffold
  5. app boots, core routes return OK
  6. at least one Hedera service (HTS, HCS, HSS or a contract) with a verifiable testnet transaction (Hashscan or Mirror Node link)
  7. no committed secrets, no committed `.env`
  8. MIT licence, original work
  9. Harness spec + validators, _only if_ Hedera Harness was used (it was not)
- Rubric: ecosystem integration 35 ("load-bearing — template impossible without it"), documentation 30, code quality 20, Hedera service depth 15 ("multiple services composed, or one used with real depth").
- The ecosystem list (DEXes, oracles, bridges, lending, storage) is explicitly "illustrative, not a checklist". Hashgraph Online / HCS-10 is not named but is a Hedera ecosystem standard.

## scaffold-hbar CLI (github.com/hedera-dev/create-scaffold-hbar, v0.4.1)

- Community template = any public GitHub repo, fetched with giget (`owner/repo[#ref]`).
- `template.json` schema (zod, `src/types.ts`): `name` required; `create-scaffold-hbar.{capabilities, defaults, outro, rename, envVars, requirements}` optional. The manifest is deleted from the generated project after processing.
- `capabilities.solidityFramework: ["none"]` is valid: it removes `packages/hardhat` and `packages/foundry`. The frontend package must live at `packages/nextjs`. Other packages (our `packages/agent`) are left untouched.
- **npm-mode rewrite trap** (`updateTextFilesForNpm`): when the user picks npm, every `.md/.json/.ts/...` file has `npm <word>` rewritten to `npm run <word>` unless `<word>` is `run`, `install`, `exec` or `ci`. Docs and code must only use those four forms, or text gets corrupted in the scaffolded copy.
- If `envVars` is set in the manifest, the CLI **overwrites** root `.env.example` with empty values. We ship `.env.example` directly and leave `envVars` out.
- Install runs `npm install --legacy-peer-deps`, then `npm run format` (failure only warns), then `git init` + first commit.
- `CREATE_SCAFFOLD_HBAR_TEMPLATE_DIR=<path>` makes the real CLI copy a local tree instead of downloading from GitHub. The eligibility script uses it to test the scaffold path before the repo is public.

## HCS-10 OpenConvAI (hol.org/docs/standards/hcs-10)

- Topic memos: registry `hcs-10:0:{ttl}:3[:metadataTopicId]`, inbound `hcs-10:0:{ttl}:0:{accountId}`, outbound `hcs-10:0:{ttl}:1`, connection `hcs-10:1:{ttl}:2:{inboundTopicId}:{connectionId}`.
- Ops: `register`, `connection_request`, `connection_created`, `connection_closed`, `message` (all `{"p":"hcs-10","op":...}`). `operator_id` = `inboundTopicId@accountId`.
- The registry is an HCS-2 topic. Anyone can create one (`HCS10Client.createRegistryTopic`).
- Message `data` over 1 KB should be stored via HCS-1 and referenced as `hcs://1/<topicId>`. The SDK does this on its own inside `sendMessage`. Our decision payloads are capped below that.
- An agent's identity is its account: account memo `hcs-11:hcs://1/<profileTopicId>` → HCS-11 profile JSON → `inboundTopicId`/`outboundTopicId`.

## @hashgraphonline/standards-sdk 0.1.187 (published 2026-09-24)

Chosen over `standards-agent-kit` (last published 2026-01, pulls in LangChain; it wraps this same SDK).

- `HCS10Client({ network, operatorId, operatorPrivateKey, keyType?, logLevel?, silent? })`.
- `createAccount(initialBalanceHbar)` → `{ accountId, privateKey }` (ED25519).
- `createAgent(AgentBuilder)` runs as the agent's own account and creates inbound + outbound topics, inscribes the HCS-11 profile (HCS-1, brokered by the Kiloscribe inscription API at kiloscribe.com), then sets the account memo.
- `createAndRegisterAgent` also calls the "guarded registry" at `https://moonscape.tech/api/request-register`. **On 2026-09-29 that endpoint answers `405 Method Not Allowed`**, so the default registration path cannot be relied on. We register on-chain instead: `createRegistryTopic()` once, then `registerAgent(registryTopicId, accountId, inboundTopicId, memo)`. These are pure HCS submissions made by the same SDK.
- Connections: `submitConnectionRequest(targetInbound, memo)` → `handleConnectionRequest(inbound, requesterAccount, requestSeq)` (creates the connection topic, which is threshold-keyed to both parties) → `waitForConnectionConfirmation(targetInbound, requestSeq)` → `sendMessage(connectionTopicId, data, memo)`.
- Reading: `retrieveProfile(accountId)`, `retrieveCommunicationTopics`, `getMessages(topicId)` (all via the Mirror Node).

## Mirror Node and Hashscan

- Testnet Mirror Node: `https://testnet.mirrornode.hedera.com/api/v1/…`
  - `/topics/{id}/messages/{sequenceNumber}` → `consensus_timestamp`, `payer_account_id`, `message` (base64), `chunk_info.initial_transaction_id`.
  - `/accounts/{id}` → `memo`, `balance`.
  - `/network/exchangerate` → HBAR/USD rate (used as the demo agent's input).
- Hashscan: `https://hashscan.io/testnet/{account|topic}/{id}`, `https://hashscan.io/testnet/transaction/{consensusTimestamp}`.
- Mirror Node typically lags consensus by a few seconds. Reads after writes must poll.

## Rejected / de-scoped

- **Pyth**: `hermes.pyth.network/v2/updates/price/latest` returns `unauthorized` without an API key (feed metadata is still public). Adding a key requirement would put an external dependency on the demo path for no HCS-10 value, so it was removed per the brief. The agent reads the network's own HBAR/USD exchange rate instead.
- **Hedera Harness**: not used, so no `.harness/` specs are required.
- **Smart contracts / wallet connect**: not needed. The agent holds its own key server-side, which is how autonomous agents actually run.
- **Kiloscribe-brokered HCS-11 profile inscription** (the SDK default): the bundled inscription SDK's login signs the wrong bytes (401), and a job authenticated by hand was paid for but never processed on testnet. Profiles are written as HCS-1 files directly on Hedera instead (`packages/agent/src/hcs1.ts`); Kiloscribe's CDN reads them back correctly. Evidence: `reports/GO_NO_GO_GATE.md`.
