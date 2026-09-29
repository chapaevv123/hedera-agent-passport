import { loadOperatorConfig, type OperatorConfig } from "../config";
import { PassportError } from "../errors";
import { loadRootEnv, stateFilePath } from "../state";

interface CliContext {
  cfg: OperatorConfig;
  statePath: string;
}

/**
 * Shared entry point for the CLI commands: loads the root .env, validates it,
 * and turns a PassportError into a readable code + fix instead of a stack trace.
 * Anything else is a bug and is printed in full.
 */
export function runCli(main: (ctx: CliContext) => Promise<void>): void {
  loadRootEnv();
  Promise.resolve()
    .then(() => main({ cfg: loadOperatorConfig(process.env), statePath: stateFilePath() }))
    .catch((error: unknown) => {
      if (error instanceof PassportError) {
        console.error(`\n✖ ${error.code}: ${error.message}\n  → ${error.hint}`);
      } else {
        console.error("\n✖ Unexpected error:", error);
      }
      process.exitCode = 1;
    })
    // The Hedera SDK keeps gRPC channels open, which would hold the process
    // alive after the command has finished.
    .finally(() => process.exit());
}

export const step = (text: string) => console.log(`\n▸ ${text}`);
export const detail = (label: string, value: string) => console.log(`  ${label.padEnd(18)} ${value}`);
