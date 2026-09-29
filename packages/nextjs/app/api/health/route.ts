import { readState, stateFilePath } from "@sh/agent";
import { NextResponse } from "next/server";
import { errorResponse, networkConfig } from "~/lib/server";

export const dynamic = "force-dynamic";

/** Liveness plus whether `npm run agent:register` has been run. */
export async function GET() {
  try {
    const { network } = networkConfig();
    const state = readState(stateFilePath());
    return NextResponse.json({ ok: true, network, agentAccountId: state?.agent?.accountId ?? null });
  } catch (error) {
    return errorResponse(error);
  }
}
