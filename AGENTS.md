# AGENTS.md

Briefing for AI coding agents working in this repository. Humans should start with `README.md`; this file covers how to change the code without breaking what it guarantees.

## What this repo is

A Scaffold-HBAR template. `packages/agent` gives an AI agent an HCS-10 identity on Hedera (account, HCS-11 profile, inbound/outbound topics, registry entry, a connection to a peer) and publishes its decisions as HCS-10 messages. `packages/nextjs` renders any agent's passport from the Mirror Node. The product guarantee is: **everything shown as fact can be re-derived from public Hedera data.** Protect that above all else.

## Directory map

| Path                                     | Responsibility                                                                                              | Touch when…                                                        |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `packages/agent/src/skills/`             | `AgentSkill` interface and skills                                                                           | adding agent behaviour (**most changes belong here**)              |
| `packages/agent/src/act.ts`              | `performAction`: decide → `sendMessage` → Mirror Node proof                                                 | changing how any decision is published                             |
| `packages/agent/src/passport.ts`         | registry, accounts, topics, HCS-11 profile, handshake (all writes except decisions)                         | changing registration or connections                               |
| `packages/agent/src/listen.ts`           | `listenOnce`: accept pending connection requests, answer peer messages; "pending" is derived from the chain | changing how the agent responds to other agents                    |
| `packages/agent/src/view.ts`             | `readPassport`: public-data-only reconstruction of an agent                                                 | changing what the UI shows                                         |
| `packages/agent/src/hcs1.ts`, `hcs10.ts` | standard codecs (HCS-1 files; HCS-10 envelopes and memos)                                                   | only to follow the specs more closely                              |
| `packages/agent/src/decision.ts`         | `agent-passport/decision@1` schema, 700-byte cap                                                            | versioning the decision format                                     |
| `packages/agent/src/mirror.ts`           | Mirror Node reads, lag polling, clock drift                                                                 | adding a read                                                      |
| `packages/agent/src/errors.ts`           | `PassportError` codes and Hedera status mapping                                                             | adding a failure mode                                              |
| `packages/agent/src/state.ts`            | `.passport/state.json` (keys + IDs), repo root, `.env` loading                                              | changing what is persisted                                         |
| `packages/agent/src/config.ts`           | env validation                                                                                              | adding a setting (also update `.env.example` and the README table) |
| `packages/agent/src/cli/`                | `register`, `act`, `status`, `listen` commands                                                              | adding a command                                                   |
| `packages/nextjs/app/api/`               | `health`, `passport`, `agent/act` routes                                                                    | exposing agent functionality over HTTP                             |
| `packages/nextjs/lib/server.ts`          | server-only config and `PassportError` → HTTP mapping                                                       | adding an error code                                               |
| `scripts/check-eligibility.mjs`          | bounty gate: scaffold → lint/build/test → boot → secrets → on-chain proof                                   | adding a gate requirement                                          |

## How to add an agent capability

1. Create `packages/agent/src/skills/<name>.ts` exporting an `AgentSkill`. Keep the decision rule a pure function (see `decideOnRate`) and wrap I/O around it.
2. Unit-test the pure rule in `packages/agent/test/`. Tests never touch the network: inject a fake `fetch` into `MirrorClient` (see `test/mirror.test.ts`).
3. Run it through `performAction(cfg, state, yourSkill)`, either from a new file in `src/cli/` plus a root `agent:<verb>` script, or from a new route in `packages/nextjs/app/api/`. Export anything the web app needs from `src/index.ts`.
4. Run it once against testnet (`npm run agent:register` first if there is no `.passport/state.json`) and confirm the message on the Mirror Node.

## Invariants: do not break

- **Writes go through `@hashgraphonline/standards-sdk`** (`HCS10Client`, `HCS11Client`, the exported `buildHcs10*Tx` builders). Do not hand-craft HCS-10 JSON for submission. The two deliberate exceptions are documented in `README.md` → Design notes (registry via `createRegistryTopic`/`registerAgent`; HCS-1 profile writer). Do not add more without the same level of justification.
- **The agent signs as itself.** Decisions and HCS-10 traffic are paid for and signed by the agent's account (`identityClient`), never the operator. Payer = agent is part of what `readPassport` verifies.
- **Reads that are shown as fact come from the Mirror Node** via `MirrorClient`, never from `state.json` or from a value returned by a write. `performAction` returns data read back from the Mirror Node for this reason.
- **Skills never get keys, clients or topic IDs.** `SkillContext` is deliberately narrow.
- **Decisions stay under `MAX_DECISION_BYTES`.** Above ~1000 bytes the SDK silently moves content into an HCS-1 inscription and the decision stops being one readable topic message.
- **State is saved before the next paid step** in `agent:register`, so reruns resume and never double-spend or lose a key.
- **Every expected failure is a `PassportError`** with a code and a concrete `hint`. Wrap SDK calls with `classifyHederaError`. Never catch and continue silently; the only swallowed error is `MIRROR_LAG` after a successful submit in `performAction`, which is reported as `verification: null`.

## Traps specific to this stack

- `standards-sdk` reports some failures as return values, not exceptions (e.g. `createRegistryTopic().success`, `updateAccountMemoWithProfile().success`). Check them.
- The Hedera client keeps gRPC channels open; CLI commands exit explicitly in `cli/run.ts`. Keep new commands on `runCli`.
- Local clocks drift; call `alignClockWithNetwork(mirror)` before signing in any new entry point.
- The Mirror Node lags consensus by seconds. After a write, poll (`waitForTopicMessage`) instead of reading once.
- `create-scaffold-hbar` in npm mode rewrites every `npm <word>` in text files to `npm run <word>`, except `run`, `install`, `exec` and `ci`. In docs, comments and strings, only write those four forms.
- `create-scaffold-hbar` installs with `--legacy-peer-deps`; `.npmrc` makes local installs match. Regenerate `package-lock.json` only with that setting in place.
- `packages/agent` is TypeScript source consumed directly (`tsx`, `vitest`, Next `transpilePackages`). There is no build step; do not add `dist/`.
- The Hedera SDKs must stay in `serverExternalPackages` in `next.config.ts`, and nothing under `app/` except `api/` and `lib/server.ts` may import runtime code from `@sh/agent` (types only), or the SDK ends up in the browser bundle.
- Node ≥ 22.15 is required (built-in zstd for HCS-1).

## Secrets and honesty

- Never commit `.env`, `.passport/`, or any private key, even a testnet one. Tests generate keys at runtime (`PrivateKey.generateED25519()`).
- Never print or log a private key. Error messages must not echo key material (`config.test.ts` checks this).
- **No fake transactions.** Do not mock a Hedera write and present the output as real, do not hard-code transaction IDs in app code, and do not add "demo mode" data to the UI. Unit tests may fake the Mirror Node's HTTP responses to test interpretation logic; label them as such. Real proof lives in `docs/testnet-proof.json` and is re-checked by `npm run check:eligibility`.

## Commands

```bash
npm install                # uses .npmrc (legacy-peer-deps), same as the scaffold CLI
npm run lint               # eslint, both workspaces
npm run build              # tsc --noEmit for agent + next build
npm run test               # vitest, no network
npm run agent:register     # testnet: needs .env with operator credentials
npm run agent:act          # testnet: publishes one real decision
npm run agent:status       # read-only Mirror Node view
npm run agent:listen       # testnet: accepts connections and answers peers until Ctrl-C
CLEANROOM_DENYLIST=<names> npm run check:eligibility   # full gate; --static skips the scaffold/boot part
```

## Definition of done

- `npm run lint`, `npm run build` and `npm run test` pass.
- New logic has tests that would fail if the logic were wrong (no snapshot-of-a-mock tests).
- Any new env var is in `config.ts`, `.env.example` and the README table.
- Any new failure mode has a `PassportErrorCode`, an HTTP status in `lib/server.ts`, and a row in the README troubleshooting table.
- Behaviour that touches Hedera has been run once on testnet and checked on the Mirror Node or Hashscan.
- `npm run check:eligibility` still reports `ELIGIBLE`.
