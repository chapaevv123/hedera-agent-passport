#!/usr/bin/env node
/**
 * Runs the Scaffold-HBAR bounty eligibility gate against this repository.
 * Every check is mechanical; one failure fails the gate.
 *
 *   node scripts/check-eligibility.mjs                     scaffold from a clean local export
 *   node scripts/check-eligibility.mjs --repo owner/repo   scaffold from GitHub, as a judge would
 *   node scripts/check-eligibility.mjs --static            skip scaffold/install/build/boot
 *
 * The local mode exports only files git would publish (tracked + untracked,
 * minus .gitignore'd) and feeds them to the real create-scaffold-hbar CLI via
 * its CREATE_SCAFFOLD_HBAR_TEMPLATE_DIR seam.
 */
import { execFileSync, spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const repoArg = args.includes("--repo") ? args[args.indexOf("--repo") + 1] : undefined;
const staticOnly = args.includes("--static");
const isWindows = process.platform === "win32";

const results = [];
function record(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}
async function check(name, fn) {
  try {
    const detail = await fn();
    record(name, true, typeof detail === "string" ? detail : "");
  } catch (error) {
    record(name, false, error instanceof Error ? error.message.split("\n")[0] : String(error));
  }
}
function run(command, cwd, env = {}) {
  // `shell` is required to run npm/npx (.cmd shims) on Windows.
  return execFileSync(command, {
    cwd,
    shell: true,
    env: { ...process.env, ...env },
    stdio: "pipe",
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

/** Files a `git push` would publish: tracked or untracked, minus anything ignored. */
function publishableFiles() {
  return run("git ls-files --cached --others --exclude-standard", ROOT)
    .split("\n")
    .map(f => f.trim())
    .filter(f => f && existsSync(join(ROOT, f)));
}

// ---------------------------------------------------------------- static ---
const files = publishableFiles();
const read = f => readFileSync(join(ROOT, f), "utf8");

await check("template.json present and valid", () => {
  const manifest = JSON.parse(read("template.json"));
  const block = manifest["create-scaffold-hbar"];
  if (typeof manifest.name !== "string" || !manifest.name) throw new Error("`name` is required");
  const allowed = {
    frontend: ["nextjs-app", "none"],
    solidityFramework: ["hardhat", "foundry", "none"],
    packageManager: ["yarn", "npm", "none"],
  };
  for (const [key, values] of Object.entries(allowed)) {
    for (const value of block?.capabilities?.[key] ?? [])
      if (!values.includes(value)) throw new Error(`capabilities.${key}: "${value}"`);
    const fallback = block?.defaults?.[key];
    if (fallback && !values.includes(fallback)) throw new Error(`defaults.${key}: "${fallback}"`);
  }
  if (block?.envVars) throw new Error("envVars would overwrite the shipped .env.example");
  return manifest.name;
});

await check("README.md and AGENTS.md present", () => {
  for (const f of ["README.md", "AGENTS.md"])
    if (!files.includes(f) || read(f).trim().length < 500) throw new Error(`${f} missing or empty`);
});

await check("MIT licence", () => {
  if (!/^MIT License/m.test(read("LICENSE"))) throw new Error("LICENSE is not MIT");
  if (JSON.parse(read("package.json")).license !== "MIT") throw new Error("package.json license is not MIT");
});

await check("no .env or passport state published", () => {
  const leaked = files.filter(f => /(^|\/)\.env($|\.(?!example$))/.test(f) || f.startsWith(".passport/"));
  if (leaked.length) throw new Error(leaked.join(", "));
  if (!files.includes(".env.example")) throw new Error(".env.example missing");
});

const SECRET_PATTERNS = [
  [/302e020100300506032b657004220420[0-9a-f]{64}/i, "DER ED25519 private key"],
  [/3030020100300706052b8104000a04220420[0-9a-f]{64}/i, "DER ECDSA private key"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "PEM private key"],
  [/(?<![0-9a-f])0x[0-9a-f]{64}(?![0-9a-f])/i, "raw 32-byte hex key"],
  [/^\s*[A-Z_]*(KEY|SECRET|TOKEN|MNEMONIC|PASSWORD)[A-Z_]*\s*=\s*\S{12,}/m, "assigned secret in env syntax"],
];
await check("no secrets in published files", () => {
  const hits = [];
  for (const f of files) {
    if (f === "package-lock.json") continue; // integrity hashes, not secrets
    const text = read(f);
    for (const [pattern, label] of SECRET_PATTERNS) if (pattern.test(text)) hits.push(`${f}: ${label}`);
  }
  if (hits.length) throw new Error(hits.join("; "));
  return `${files.length} files scanned`;
});

await check("no secrets in git history", () => {
  const history = run("git log --all -p --no-color", ROOT);
  for (const [pattern, label] of SECRET_PATTERNS.slice(0, 4)) if (pattern.test(history)) throw new Error(label);
  return history ? "history scanned" : "no commits yet";
});

// Names of private codebases this must not contain. Passed at run time so the
// names themselves are never published: CLEANROOM_DENYLIST=foo,bar
await check("clean-room: no denylisted identifiers", () => {
  const terms = (process.env.CLEANROOM_DENYLIST ?? "")
    .split(",")
    .map(t => t.trim().toLowerCase())
    .filter(Boolean);
  if (!terms.length) throw new Error("set CLEANROOM_DENYLIST to the private project names to scan for");
  const hits = files.filter(f => terms.some(t => f.toLowerCase().includes(t) || read(f).toLowerCase().includes(t)));
  if (hits.length) throw new Error(`${hits.length} file(s) match: ${hits.join(", ")}`);
  return `${terms.length} term(s), ${files.length} files`;
});

// ---------------------------------------------------------- testnet proof ---
await check("real testnet transactions verifiable on the Mirror Node", async () => {
  const proof = JSON.parse(read("docs/testnet-proof.json"));
  const mirror = `https://${proof.network}.mirrornode.hedera.com/api/v1`;
  const get = async path => {
    const response = await fetch(`${mirror}${path}`);
    if (!response.ok) throw new Error(`${path} → ${response.status}`);
    return response.json();
  };
  const decode = m => JSON.parse(Buffer.from(m.message, "base64").toString("utf8"));

  const account = await get(`/accounts/${proof.agentAccountId}?transactions=false`);
  if (!account.memo.startsWith("hcs-11:hcs://1/"))
    throw new Error(`agent memo "${account.memo}" is not an HCS-11 reference`);

  const registry = (await get(`/topics/${proof.registryTopicId}/messages?limit=100`)).messages.map(decode);
  if (!registry.some(m => m.p === "hcs-10" && m.op === "register" && m.account_id === proof.agentAccountId)) {
    throw new Error("no HCS-10 register entry for the agent");
  }

  const connection = await get(`/topics/${proof.connectionTopicId}`);
  if (!connection.memo.startsWith("hcs-10:1:")) throw new Error(`connection topic memo "${connection.memo}"`);

  for (const sequence of proof.decisionSequenceNumbers) {
    const message = await get(`/topics/${proof.connectionTopicId}/messages/${sequence}`);
    const envelope = decode(message);
    if (envelope.op !== "message" || !envelope.operator_id.endsWith(`@${proof.agentAccountId}`))
      throw new Error(`#${sequence} is not an HCS-10 message from the agent`);
    if (message.payer_account_id !== proof.agentAccountId) throw new Error(`#${sequence} was not paid by the agent`);
    if (JSON.parse(envelope.data).schema !== "agent-passport/decision@1")
      throw new Error(`#${sequence} is not a decision`);
  }
  // An independent agent asked over its own connection; the agent answered with a decision.
  const exchange = proof.externalExchange;
  const question = await get(`/topics/${exchange.connectionTopicId}/messages/${exchange.questionSequenceNumber}`);
  const answer = await get(`/topics/${exchange.connectionTopicId}/messages/${exchange.answerSequenceNumber}`);
  if (question.payer_account_id !== exchange.externalAccountId || decode(question).op !== "message") {
    throw new Error("external question is not an HCS-10 message from the external agent");
  }
  if (
    answer.payer_account_id !== proof.agentAccountId ||
    JSON.parse(decode(answer).data).schema !== "agent-passport/decision@1"
  ) {
    throw new Error("answer is not a decision from the agent");
  }
  return `${proof.decisionSequenceNumbers.length} decisions on ${proof.connectionTopicId}; external Q&A on ${exchange.connectionTopicId}`;
});

// -------------------------------------------------------------- scaffold ---
if (!staticOnly) {
  const work = mkdtempSync(join(tmpdir(), "scaffold-hbar-check-"));
  const exportDir = join(work, "template");
  const appDir = join(work, "app");
  let scaffolded = false;

  await check(`scaffolds via create-scaffold-hbar${repoArg ? ` --template ${repoArg}` : " (local export)"}`, () => {
    const env = {};
    if (!repoArg) {
      mkdirSync(exportDir);
      for (const f of files) cpSync(join(ROOT, f), join(exportDir, f), { recursive: true });
      env.CREATE_SCAFFOLD_HBAR_TEMPLATE_DIR = exportDir;
    }
    // The CLI refuses to run without a git identity; supply a throwaway one if the machine has none.
    try {
      run("git config --global user.email", work);
    } catch {
      const gitconfig = join(work, "gitconfig");
      writeFileSync(gitconfig, "[user]\n\tname = Eligibility Check\n\temail = check@example.invalid\n");
      env.GIT_CONFIG_GLOBAL = gitconfig;
    }
    run(
      `npx -y create-scaffold-hbar@latest app --template ${repoArg ?? "local/agent-passport"} ` +
        "--frontend nextjs-app --solidity-framework none --package-manager npm --network testnet --skip-hedera-skills --yes",
      work,
      env,
    );
    if (!existsSync(join(appDir, "node_modules"))) throw new Error("dependencies were not installed");
    if (existsSync(join(appDir, "template.json"))) throw new Error("template.json should be consumed by the CLI");
    scaffolded = true;
    return "install ran inside the CLI (npm install --legacy-peer-deps)";
  });

  for (const script of ["lint", "build", "test"]) {
    await check(`npm run ${script} in the scaffolded project`, () => {
      if (!scaffolded) throw new Error("skipped: scaffold failed");
      run(`npm run ${script}`, appDir);
    });
  }

  await check("app boots and core routes return 200", async () => {
    if (!scaffolded) throw new Error("skipped: scaffold failed");
    const port = 3900 + Math.floor(Math.random() * 90);
    const server = spawn(`npx next start -p ${port}`, {
      cwd: join(appDir, "packages", "nextjs"),
      shell: true,
      stdio: "ignore",
    });
    try {
      const base = `http://localhost:${port}`;
      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline) {
        try {
          if ((await fetch(`${base}/api/health`)).ok) break;
        } catch {
          /* not listening yet */
        }
        await new Promise(r => setTimeout(r, 1000));
      }
      const statuses = [];
      for (const route of ["/", "/api/health"]) {
        const response = await fetch(`${base}${route}`);
        statuses.push(`${route} ${response.status}`);
        if (response.status !== 200) throw new Error(statuses.join(", "));
      }
      // Without .env/.passport the passport API must fail with guidance, not crash.
      const passport = await fetch(`${base}/api/passport`);
      const body = await passport.json();
      if (passport.status !== 409 || body.error?.code !== "NOT_REGISTERED")
        throw new Error(`/api/passport ${passport.status}`);
      return `${statuses.join(", ")}, /api/passport 409 NOT_REGISTERED (expected before registration)`;
    } finally {
      if (isWindows) spawn("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" });
      else server.kill("SIGTERM");
    }
  });

  if (!args.includes("--keep")) rmSync(work, { recursive: true, force: true, maxRetries: 5 });
  else console.log(`kept ${work}`);
}

const failed = results.filter(r => !r.ok);
console.log(
  `\n${failed.length ? "NOT ELIGIBLE" : "ELIGIBLE"}: ${results.length - failed.length}/${results.length} checks passed`,
);
process.exitCode = failed.length ? 1 : 0;
