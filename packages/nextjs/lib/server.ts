import "server-only";
import { loadNetworkConfig, loadRootEnv, PassportError, type NetworkConfig, type PassportErrorCode } from "@sh/agent";
import { NextResponse } from "next/server";
import type { ApiError } from "./api";

loadRootEnv();

export function networkConfig(): NetworkConfig {
  return loadNetworkConfig(process.env);
}

const STATUS: Partial<Record<PassportErrorCode, number>> = {
  NOT_REGISTERED: 409,
  INVALID_CONFIG: 400,
  MISSING_CREDENTIALS: 500,
  WRONG_NETWORK: 500,
  INSUFFICIENT_BALANCE: 402,
  MIRROR_LAG: 503,
  MIRROR_UNAVAILABLE: 503,
  INPUT_UNAVAILABLE: 503,
};

/** Expected failures keep their code and fix; anything else is logged and reported as INTERNAL. */
export function errorResponse(error: unknown): NextResponse<ApiError> {
  if (error instanceof PassportError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message, hint: error.hint } },
      { status: STATUS[error.code] ?? 502 },
    );
  }
  console.error(error);
  return NextResponse.json(
    {
      error: {
        code: "INTERNAL",
        message: error instanceof Error ? error.message : String(error),
        hint: "This is a bug in the template; the server log has the stack trace.",
      },
    },
    { status: 500 },
  );
}
