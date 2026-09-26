import { mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage } from "node:http";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createAuditLog } from "@acme/audit-log";

import { createApp, type ToolDeps } from "./app";
import { ToolAuditLogStore } from "./audit-store";
import { createCoreClient } from "./core-api";
import { openToolDatabase } from "./db";

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(HERE, "..", "public");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (raw === "") return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/**
 * Serves the static UI from public/ and routes /api/* through the app.
 */
export function createToolServer(deps: ToolDeps) {
  const app = createApp(deps);

  return createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    try {
      if (url.pathname.startsWith("/api/")) {
        const result = await app.handle({
          method: request.method ?? "GET",
          url: url.pathname + url.search,
          headers: request.headers,
          body: request.method === "POST" ? await readBody(request) : undefined,
        });
        response.writeHead(result.status, { "content-type": "application/json" });
        response.end(JSON.stringify(result.body));
        return;
      }

      const file = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
      const content = await readFile(join(PUBLIC_DIR, file)).catch(() => null);
      if (content === null) {
        response.writeHead(404, { "content-type": "text/plain" });
        response.end("Not found");
        return;
      }
      response.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
      response.end(content);
    } catch (error) {
      response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "internal", message: "Unexpected error." }));
      console.error(error);
    }
  });
}

export function startServer(): void {
  const port = Number(process.env.MY_QUEUE_PORT ?? 3200);
  const dbFile = process.env.MY_QUEUE_DB ?? join(HERE, "..", "data", "my-queue.db");
  mkdirSync(dirname(dbFile), { recursive: true });

  const db = openToolDatabase(dbFile);
  const server = createToolServer({
    core: createCoreClient({ baseUrl: process.env.REFUNDS_API_URL ?? "http://localhost:3000" }),
    db,
    auditLog: createAuditLog(new ToolAuditLogStore(db)),
  });
  server.listen(port, () => {
    console.log(`my-queue listening on http://localhost:${port}`);
  });
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  startServer();
}
