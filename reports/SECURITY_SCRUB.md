# Security scrub

Date: 2026-09-29. Scope: every file `git push` would publish (`git ls-files --cached --others --exclude-standard`, 65 files), plus git history.

**Result: PASS**

| Check                                  | Result | Method                                                                                                                                                                                          |
| -------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No `.env` published                    | PASS   | `.env` and `.env.*` are git-ignored except `.env.example` (`git check-ignore -v .env`)                                                                                                          |
| No agent state published               | PASS   | `.passport/` (holds agent private keys) is git-ignored; the eligibility script fails if any `.passport/` path is publishable                                                                    |
| No real private keys                   | PASS   | The operator key (from `.env`) and all four passport keys (two state files), in DER and raw form, were searched for literally in every publishable file: **0 hits**. Values were never printed. |
| No key-shaped strings                  | PASS   | Pattern scan (`scripts/check-eligibility.mjs`): DER ED25519/ECDSA private-key prefixes, PEM blocks, 0x + 64 hex, `*KEY/SECRET/TOKEN/MNEMONIC/PASSWORD=<value>`                                  |
| No API secrets or mnemonics            | PASS   | Same pattern scan; the template uses no API keys (Mirror Node and HCS need none)                                                                                                                |
| No credentials in git history          | PASS   | No commits exist yet (owner has not chosen an author identity). The eligibility script scans `git log --all -p` once there is history.                                                          |
| No private-project code or identifiers | PASS   | Clean-room written from scratch in a new directory. Deny-list scan via `CLEANROOM_DENYLIST` (the terms are supplied at run time so they are never published): 0 hits                            |
| No personal data or local paths        | PASS   | Searched for the owner's email/handle, Windows user profile paths and `AppData`: 0 hits. The owner's operator account ID was removed from the gate report.                                      |
| No backups, databases, logs, key files | PASS   | No `*.bak`, `*.db`, `*.sqlite`, `*.log`, `*.pem`, `*.key`, `*.p12` or `~` files publishable                                                                                                     |
| Test keys                              | PASS   | Tests generate keys at runtime (`PrivateKey.generate*`); no fixture keys in the repo                                                                                                            |
| Key material never echoed              | PASS   | `parsePrivateKey` errors do not include the input (`config.test.ts` asserts it); the CLI prints account IDs, never keys; `state.json` is written with mode `0600`                               |

## Dependency advisories (`npm audit --omit=dev`)

Before: 1 critical, 6 high. After root `overrides` (same-major bumps of `protobufjs` 8.0.0→8.8.0, `@grpc/grpc-js` 1.12.6→1.14.5, `ws`→8.22, `postcss`): **0 critical, 1 high**. A real testnet decision was published after the change to confirm the Hedera SDK still works on the patched gRPC and protobuf versions.

Remaining high: `postcss` 8.4.31 vendored inside `next`. It only processes this repo's own CSS at build time and never touches untrusted input. It clears when Next.js updates its pin.

## Operational security notes (documented for users)

- The operator key is only needed by `agent:register`; the web server never reads it.
- Each agent signs with its own key from `.passport/state.json`. Losing that file loses control of the agent's account and its HBAR; leaking it lets someone else publish as the agent. The README and CLI output say so.
- `agent:listen` accepts connection requests from anyone and pays for each connection topic and answer, so a spammer can drain the agent's balance. The README says so and points to an allowlist or an HCS-10 fee-based inbound topic (HIP-991).
- `POST /api/agent/act` has no authentication. It is a local development server, and anyone who can reach it can make the agent spend about 0.006 HBAR per call. Put it behind auth before exposing it.
