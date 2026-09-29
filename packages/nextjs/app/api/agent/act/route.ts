import { exchangeRateWatch, performAction, readState, requireConnectedState, stateFilePath } from "@sh/agent";
import { NextResponse } from "next/server";
import { errorResponse, networkConfig } from "~/lib/server";

export const dynamic = "force-dynamic";

/**
 * POST /api/agent/act — runs one step of the demo skill as the local agent
 * and returns the decision with its consensus proof (or null proof while the
 * Mirror Node catches up; the message is already final either way).
 */
export async function POST() {
  try {
    const state = requireConnectedState(readState(stateFilePath()));
    const result = await performAction(networkConfig(), state, exchangeRateWatch);
    return NextResponse.json(result, { status: result.verification ? 200 : 202 });
  } catch (error) {
    return errorResponse(error);
  }
}
