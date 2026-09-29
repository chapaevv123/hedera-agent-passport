# Submission summary

**Template:** Agent Passport · **Bounty:** Scaffold-HBAR Template Bounty (submissions close 2026-10-04 23:59 ET)

## Short description (for the form)

Agent Passport gives any AI agent a verifiable Hedera identity, a standards-compliant communication channel and a tamper-proof decision log, in one scaffold command. Built on Hashgraph Online's HCS-10 OpenConvAI standard (with HCS-11 profiles, HCS-1 files and an HCS-2 registry), it registers the agent, runs a real HCS-10 connection handshake, publishes each decision as a consensus-timestamped HCS-10 message signed by the agent's own key, and lets any other HCS-10 agent connect and query it. The UI rebuilds every passport from the Mirror Node alone, so anyone can verify what an agent did without trusting its server.

## Testnet proof link (for the form)

- Primary: https://hashscan.io/testnet/topic/0.0.10776024 (the agent's HCS-10 connection topic / decision log)
- Raw: https://testnet.mirrornode.hedera.com/api/v1/topics/0.0.10776024/messages
- Agent-to-agent: https://testnet.mirrornode.hedera.com/api/v1/topics/0.0.10777060/messages

All IDs: `docs/testnet-proof.json`, re-verified on-chain by `npm run check:eligibility`.

## Package contents

| Item                                                                                                                     | Location                        |
| ------------------------------------------------------------------------------------------------------------------------ | ------------------------------- |
| Template manifest                                                                                                        | `template.json`                 |
| README (pitch, proof, architecture diagram, quickstart, env table, verification walkthrough, extension, troubleshooting) | `README.md`                     |
| AI-agent briefing                                                                                                        | `AGENTS.md`                     |
| MIT licence                                                                                                              | `LICENSE`                       |
| Demo script (2:45)                                                                                                       | `docs/DEMO_SCRIPT.md`           |
| Research notes                                                                                                           | `docs/RESEARCH_NOTES.md`        |
| Eligibility gate (13 checks, runnable)                                                                                   | `scripts/check-eligibility.mjs` |
| Go / no-go, security, slop audit, red team                                                                               | `reports/`                      |

## Hedera Harness

Not used, so no `.harness/` specs are required.
