import type { AuditLog } from "@acme/audit-log";

import type { CoreClient, RefundItem } from "./core-api";
import type { ToolDb } from "./db";
import { identityFromHeaders } from "./identity";
import { addNote, listNotes } from "./notes";
import { orderQueue, summarizeQueue } from "./queue";

export type ToolRequest = {
  method: string;
  /** path + query string, e.g. "/api/queue?status=pending" */
  url: string;
  headers: Record<string, string | string[] | undefined>;
  /** parsed JSON body for POSTs, undefined otherwise */
  body?: unknown;
};

export type ToolResponse = { status: number; body: unknown };

export type ToolDeps = {
  core: CoreClient;
  db: ToolDb;
  auditLog: AuditLog;
};

function json(status: number, body: unknown): ToolResponse {
  return { status, body };
}

/**
 * The tool's API surface. Every refund read or write goes through the core
 * /api/v1/refunds endpoints with the caller's identity headers forwarded
 * unchanged — a rejection from the core API is surfaced verbatim and nothing
 * is decided locally. Notes and the tool's audit trail are the tool's own
 * data in its own database.
 */
export function createApp({ core, db, auditLog }: ToolDeps) {
  async function handle(request: ToolRequest): Promise<ToolResponse> {
    const url = new URL(request.url, "http://my-queue.local");
    const path = url.pathname;
    const identity = identityFromHeaders(request.headers);
    const actor = identity.userId ?? "unknown";

    if (request.method === "GET" && path === "/api/queue") {
      const result = await core.listMine(identity);
      if (result.status !== 200 || typeof result.body !== "object" || result.body === null) {
        return json(result.status, result.body);
      }
      const items = (result.body as { items: RefundItem[] }).items;
      const notes: Record<string, ReturnType<typeof listNotes>> = {};
      for (const item of items) {
        notes[item.id] = listNotes(db, item.id);
      }
      return json(200, {
        items: orderQueue(items),
        summary: summarizeQueue(items),
        notes,
      });
    }

    const decisionMatch = /^\/api\/queue\/([^/]+)\/(approve|deny)$/.exec(path);
    if (request.method === "POST" && decisionMatch) {
      const id = decisionMatch[1]!;
      const action = decisionMatch[2]!;
      const body = (typeof request.body === "object" && request.body !== null ? request.body : {}) as Record<
        string,
        unknown
      >;
      const result =
        action === "approve"
          ? await core.approve(identity, id, typeof body.note === "string" ? body.note : undefined)
          : await core.deny(identity, id, typeof body.reason === "string" ? body.reason : "");
      // Whatever the core API answered — including 403 and 409 — is surfaced
      // as-is; the tool never fabricates a decision.
      return json(result.status, result.body);
    }

    const notesMatch = /^\/api\/queue\/([^/]+)\/notes$/.exec(path);
    if (notesMatch) {
      const id = notesMatch[1]!;
      if (request.method === "GET") {
        return json(200, { notes: listNotes(db, id) });
      }
      if (request.method === "POST") {
        const body = (typeof request.body === "object" && request.body !== null ? request.body : {}) as Record<
          string,
          unknown
        >;
        if (typeof body.body !== "string") {
          return json(400, { error: "validation", message: "Note body is required." });
        }
        try {
          const note = await addNote(db, auditLog, { refundId: id, body: body.body, actor });
          return json(201, { note });
        } catch (error) {
          return json(400, { error: "validation", message: (error as Error).message });
        }
      }
    }

    if (request.method === "GET" && path === "/api/audit") {
      return json(200, { records: await auditLog.queryAuditLog({}) });
    }

    return json(404, { error: "not_found", message: `No route for ${request.method} ${path}.` });
  }

  return { handle };
}
