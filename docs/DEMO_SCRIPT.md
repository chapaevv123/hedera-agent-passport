# Demo script (2:45)

Everything on screen is live Hedera testnet activity. No slides except the architecture diagram from the README.

## Before recording

- Terminal A in an empty folder; terminal B in a project that is already registered (`.passport/state.json` exists) with `npm run dev` running.
- Browser tabs: `http://localhost:3000`, Hashscan testnet, and a blank tab for a Mirror Node URL.
- Operator account funded (about 15 HBAR per fresh registration). Clock synced, or trust the drift correction.
- Registration takes about a minute. Record it live in terminal A, or cut to terminal B's earlier run; say which.

## 0:00–0:20 · One command

Terminal A:

```bash
npm create scaffold-hbar@latest -- --template <owner>/hedera-agent-passport
```

> "Agent Passport is a Scaffold-HBAR template. One command gives an AI agent a Hedera identity, an HCS-10 communication channel and a decision log anyone can verify. The CLI picks Next.js, no Solidity and npm, because that's all this template needs."

Show the outro listing `agent:register`, `agent:act`, `dev`.

## 0:20–0:45 · Register a real agent

```bash
cp .env.example .env   # operator ID + key already pasted off-camera
npm run agent:register
```

> "This creates the agent's own account, its HCS-10 inbound and outbound topics, an HCS-11 profile stored on-chain, and a registry entry. Then it creates a peer, an auditor agent, and runs the full HCS-10 connection handshake."

Click the agent's account link in the output → Hashscan. Point at the **memo**: `hcs-11:hcs://1/0.0.…`.

> "The account memo is the passport: it points at the profile, which points at the topics."

## 0:45–1:30 · One real agent action

Switch to the browser (terminal B's app). Walk top to bottom:

- **Identity**: name, model, capabilities, "hash verified" (the profile was reassembled from the Mirror Node and matched its SHA-256).
- **Communication**: inbound and outbound topics with their HCS-10 memos checked; the registry entry; the connection to the auditor.

Press **Run agent step**.

> "The skill reads Hedera's own HBAR/USD rate, compares it with its last decision, which it reads back from the chain, and decides. The decision goes out as a standard HCS-10 `message`, signed and paid for by the agent's own key."

The new entry appears with its consensus timestamp. Expand the timeline: `BASELINE` first, then `HOLD`s.

## 1:30–2:00 · Verify without this app

Click **Mirror Node #n** on the newest decision, or paste the `curl` from the "Verify it yourself" card:

```bash
curl -s https://testnet.mirrornode.hedera.com/api/v1/topics/<connection>/messages/<n> \
  | jq '{consensus_timestamp, payer_account_id, message: (.message | @base64d | fromjson)}'
```

> "`p: hcs-10`, `op: message`. The `operator_id` ends in the agent's account, and the payer is the agent. The consensus timestamp was assigned by the network, not by us."

Click **Hashscan** on the same entry to show the transaction.

## 2:00–2:30 · Why HCS-10 is load-bearing

Show the README's architecture diagram.

> "Writes go through the Hashgraph Online standards SDK; reads come only from the Mirror Node. Take HCS-10 away and there's no identity, no address, no channel and no log. There isn't a database underneath to fall back on. It also works for agents we didn't create: paste any HCS-10 account into the box and you get its passport."

Paste the peer's account ID into the input → **Load passport**. It shows the same connection from the other side.

Optional 10 seconds, if time allows: run `npm run agent:listen` in terminal B and show the proof from the README. An unrelated agent, using only the raw SDK, opened its own connection and got a decision back (`0.0.10777060`).

> "And it's not just a log. With `agent:listen`, any HCS-10 agent can connect and ask it something."

## 2:30–2:45 · Extending it

Open `packages/agent/src/skills/exchange-rate-watch.ts` next to the README's `deploy-guard` example.

> "Your code is a skill: one `decide` function returning an action, a reason and the evidence. Keys, topics, consensus and proof are the template's job."

End.
