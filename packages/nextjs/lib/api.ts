import type { PassportErrorCode } from "@sh/agent";

/** Body of every non-2xx API response; shared by the routes and the UI. */
export interface ApiError {
  error: { code: PassportErrorCode | "NOT_FOUND" | "INTERNAL"; message: string; hint: string };
}
