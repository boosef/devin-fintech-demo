import "server-only";

import { isRefundServiceError } from "./errors";

export function errorResponse(error: unknown): Response {
  if (isRefundServiceError(error)) {
    return Response.json({ error: error.code, message: error.message }, { status: error.httpStatus });
  }
  console.error(error);
  return Response.json({ error: "internal", message: "Unexpected error." }, { status: 500 });
}

/** Requires a JSON body, which a cross-site HTML form cannot send without a CORS preflight. */
export async function readJsonBody(request: Request): Promise<Record<string, unknown> | Response> {
  if (!request.headers.get("content-type")?.includes("application/json")) {
    return Response.json({ error: "unsupported_media_type", message: "Send application/json." }, { status: 415 });
  }
  const body: unknown = await request.json().catch(() => null);
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ error: "validation", message: "Body must be a JSON object." }, { status: 400 });
  }
  return body as Record<string, unknown>;
}
