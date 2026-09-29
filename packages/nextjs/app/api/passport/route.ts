import { MirrorClient, PassportError, readPassport, readState, stateFilePath } from "@sh/agent";
import { NextResponse, type NextRequest } from "next/server";
import { errorResponse, networkConfig } from "~/lib/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/passport?account=0.0.x — any HCS-10 agent, read from the Mirror Node.
 * Without `account`, the agent created by `npm run agent:register`.
 */
export async function GET(request: NextRequest) {
  try {
    const { network, mirrorNodeUrl } = networkConfig();
    const state = readState(stateFilePath());
    const accountId = request.nextUrl.searchParams.get("account")?.trim() || state?.agent?.accountId;
    if (!accountId) {
      throw new PassportError(
        "NOT_REGISTERED",
        "No agent has been registered yet.",
        "Run `npm run agent:register`, or enter the account ID of any HCS-10 agent.",
      );
    }
    if (!/^0\.0\.\d+$/.test(accountId)) {
      throw new PassportError("INVALID_CONFIG", `"${accountId}" is not an account ID.`, "Use the 0.0.x form.");
    }
    const view = await readPassport(new MirrorClient(mirrorNodeUrl), network, accountId, state?.registryTopicId);
    if (!view) {
      return NextResponse.json(
        {
          error: {
            code: "NOT_FOUND",
            message: `${accountId} does not exist on ${network}.`,
            hint: "Check the ID and HEDERA_NETWORK.",
          },
        },
        { status: 404 },
      );
    }
    return NextResponse.json({ passport: view, isLocalAgent: accountId === state?.agent?.accountId });
  } catch (error) {
    return errorResponse(error);
  }
}
