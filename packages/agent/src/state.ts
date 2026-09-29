import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { config as loadDotenv } from "dotenv";
import { z } from "zod";
import type { Network } from "./config";
import { PassportError } from "./errors";

/**
 * Local state holds only what the network cannot give back: private keys, and
 * IDs we need before the Mirror Node has indexed them. Every field is optional
 * so a registration interrupted half-way can resume without paying twice.
 */
const IdentitySchema = z.object({
  accountId: z.string(),
  privateKey: z.string(),
  inboundTopicId: z.string().optional(),
  outboundTopicId: z.string().optional(),
  profileTopicId: z.string().optional(),
  registered: z.boolean().optional(),
});

const StateSchema = z.object({
  version: z.literal(1),
  network: z.enum(["testnet", "mainnet"]),
  registryTopicId: z.string().optional(),
  agent: IdentitySchema.optional(),
  peer: IdentitySchema.optional(),
  connectionTopicId: z.string().optional(),
});

export type PassportIdentity = z.infer<typeof IdentitySchema>;
export type PassportState = z.infer<typeof StateSchema>;
/** An identity whose HCS-10 topics exist. */
export type RegisteredIdentity = Required<Omit<PassportIdentity, "registered">> & { registered: true };

/** The workspace root: the nearest ancestor whose package.json declares workspaces. */
function findRepoRoot(start: string = process.cwd()): string {
  let dir = resolve(start);
  for (;;) {
    const pkg = join(dir, "package.json");
    if (existsSync(pkg) && "workspaces" in JSON.parse(readFileSync(pkg, "utf8"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return resolve(start);
    dir = parent;
  }
}

/** Loads the single root .env shared by the CLI and the Next.js server. */
export function loadRootEnv(): void {
  loadDotenv({ path: join(findRepoRoot(), ".env"), quiet: true });
}

export function stateFilePath(env: Record<string, string | undefined> = process.env): string {
  return env.PASSPORT_STATE_FILE?.trim() || join(findRepoRoot(), ".passport", "state.json");
}

export function readState(path: string): PassportState | null {
  if (!existsSync(path)) return null;
  const parsed = StateSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
  if (!parsed.success) {
    throw new PassportError(
      "INVALID_CONFIG",
      `${path} is not a valid passport state file: ${parsed.error.issues[0]?.message}`,
      "Move the file aside and run `npm run agent:register` to create fresh passports.",
    );
  }
  return parsed.data;
}

export function writeState(path: string, state: PassportState): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
}

function isRegistered(identity: PassportIdentity | undefined): identity is RegisteredIdentity {
  return Boolean(
    identity?.registered && identity.inboundTopicId && identity.outboundTopicId && identity.profileTopicId,
  );
}

/** The state `act` and the API need: two registered passports joined by a connection topic. */
export interface ConnectedState {
  network: Network;
  registryTopicId: string;
  agent: RegisteredIdentity;
  peer: RegisteredIdentity;
  connectionTopicId: string;
}

export function requireConnectedState(state: PassportState | null): ConnectedState {
  if (
    !state ||
    !state.registryTopicId ||
    !isRegistered(state.agent) ||
    !isRegistered(state.peer) ||
    !state.connectionTopicId
  ) {
    throw new PassportError(
      "NOT_REGISTERED",
      "No connected agent passport found.",
      "Run `npm run agent:register` first; it creates the agent, its peer and the HCS-10 connection between them.",
    );
  }
  return state as ConnectedState;
}
