#!/usr/bin/env node
import { createServer as createHttpServer, type IncomingMessage } from "node:http";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "./server.js";
import { drugPrice, drugInfo } from "./drugs.js";
import { data, startRefresh } from "./data.js";
import { usage } from "./usage.js";
import { landingHtml } from "./landing.js";
import { UserError, log } from "./config.js";
import { VERSION } from "./version.js";

const HELP = `leki-mcp ${VERSION} - Polish medicines for AI agents (MCP): refunded prices, patient co-payment, cheaper substitutes, leaflets

Usage:
  leki-mcp                                MCP server on stdio (Claude, Cursor, VS Code, ...)
  leki-mcp --http [--port 3000] [--host 127.0.0.1]   Streamable HTTP at /mcp
  leki-mcp price "<drug>" [--indication "..."]     e.g. leki-mcp price "Tulip 20 mg 30 szt"
  leki-mcp info "<drug>"                           registration data, Rx/OTC, leaflet

Data is downloaded on first use (≈20 MB) and refreshed daily.

Environment:
  LEKI_DATA_DIR        cache directory (default ~/.cache/leki-mcp)
  LEKI_REFRESH_HOURS   refresh interval (default 24)
  LEKI_REFUND_XLSX_URL direct link to the refund list annex (.xlsx) instead of discovery on gov.pl
  LEKI_RATE_LIMIT      HTTP: requests per minute per IP (default off)
  LEKI_TRUST_PROXY=1   HTTP: client IP from X-Forwarded-For
  LEKI_STATS=1         HTTP: anonymous daily usage counters at /stats
  LEKI_CONTACT         HTTP: operator e-mail for /.well-known/security.txt
  LEKI_PUBLIC_URL      HTTP: public origin for the landing page
`;

function parseArgs(argv: string[]) {
  const pos: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--") && !["http", "help", "version"].includes(key)) {
        flags[key] = next;
        i++;
      } else flags[key] = true;
    } else pos.push(a);
  }
  return { pos, flags };
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 1_000_000) throw new Error("request too large");
    chunks.push(c as Buffer);
  }
  if (!chunks.length) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const RATE = Number(process.env.LEKI_RATE_LIMIT ?? 0);
const TRUST_PROXY = process.env.LEKI_TRUST_PROXY === "1";
const hits = new Map<string, { n: number; reset: number }>();
function clientIp(req: IncomingMessage): string {
  if (TRUST_PROXY) {
    const xf = req.headers["x-forwarded-for"];
    const v = Array.isArray(xf) ? xf[0] : xf;
    if (v) return v.split(",")[0].trim();
  }
  return req.socket.remoteAddress ?? "?";
}
function rateLimited(req: IncomingMessage): boolean {
  if (!RATE) return false;
  const ip = clientIp(req);
  const now = Date.now();
  let h = hits.get(ip);
  if (!h || now > h.reset) {
    h = { n: 0, reset: now + 60_000 };
    hits.set(ip, h);
    if (hits.size > 50_000) for (const [k, v] of hits) if (now > v.reset) hits.delete(k);
  }
  return ++h.n > RATE;
}

async function startHttp(port: number, host: string) {
  const httpServer = createHttpServer(async (req, res) => {
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-headers", "content-type, accept, mcp-protocol-version, mcp-session-id, authorization");
    res.setHeader("access-control-allow-methods", "POST, GET, OPTIONS");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    try {
      const url = new URL(req.url ?? "/", "http://x");
      if (url.pathname === "/") {
        if (String(req.headers.accept ?? "").includes("text/html")) {
          const proto = TRUST_PROXY ? String(req.headers["x-forwarded-proto"] ?? "https").split(",")[0] : "http";
          const base = (process.env.LEKI_PUBLIC_URL ?? `${proto}://${req.headers.host ?? "localhost"}`).replace(/\/$/, "");
          res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "max-age=600" });
          res.end(landingHtml(base, usage.enabled));
        } else {
          res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
          res.end(`leki-mcp ${VERSION} - Polish medicines for AI agents (MCP): refund prices, patient co-payments, cheaper substitutes.\nMCP endpoint: POST /mcp\nhttps://github.com/ContentWriterco/leki-mcp\n`);
        }
        return;
      }
      if (url.pathname === "/health") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, version: VERSION }));
        return;
      }
      if (url.pathname === "/.well-known/security.txt" && process.env.LEKI_CONTACT) {
        res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
        res.end(`Contact: mailto:${process.env.LEKI_CONTACT}\nExpires: ${new Date(Date.now() + 180 * 86400_000).toISOString()}\nPreferred-Languages: pl, en\n`);
        return;
      }
      if (url.pathname === "/stats" && usage.enabled) {
        res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "max-age=300" });
        res.end(JSON.stringify(await usage.summary(), null, 1));
        return;
      }
      if (url.pathname !== "/mcp") {
        res.writeHead(404, { "content-type": "text/plain" });
        res.end("MCP endpoint is /mcp\n");
        return;
      }
      if (req.method !== "POST") {
        res.writeHead(405, { allow: "POST" });
        res.end();
        return;
      }
      if (rateLimited(req)) {
        void usage.request(clientIp(req), undefined, true);
        res.writeHead(429, { "content-type": "application/json", "retry-after": "60" });
        res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: `Rate limit: ${RATE} requests/minute.` }, id: null }));
        return;
      }
      const body = await readBody(req);
      if (usage.enabled) {
        const msgs = (Array.isArray(body) ? body : [body]) as { method?: string; params?: { clientInfo?: { name?: string } } }[];
        const init = msgs.find((m) => m?.method === "initialize");
        void usage.request(clientIp(req), init ? (init.params?.clientInfo?.name ?? "unknown") : undefined);
      }
      const server = createServer();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on("close", () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (e) {
      log("error", (e as Error).message);
      if (!res.headersSent) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32700, message: (e as Error).message }, id: null }));
      }
    }
  });
  usage.start();
  httpServer.listen(port, host, () => log("info", `HTTP MCP endpoint: http://${host}:${port}/mcp`));
  data().catch((e) => log("error", `initial data load failed: ${(e as Error).message}`));
  startRefresh();
}

async function main() {
  const { pos, flags } = parseArgs(process.argv.slice(2));
  const opt = (k: string) => (typeof flags[k] === "string" ? (flags[k] as string) : undefined);
  if (flags.help) return void process.stdout.write(HELP);
  if (flags.version) return void process.stdout.write(VERSION + "\n");
  try {
    if (pos[0] === "price") {
      if (!pos[1]) throw new UserError('usage: leki-mcp price "<drug>"');
      process.stdout.write((await drugPrice({ query: pos[1], indication: opt("indication") })) + "\n");
      return;
    }
    if (pos[0] === "info") {
      if (!pos[1]) throw new UserError('usage: leki-mcp info "<drug>"');
      process.stdout.write((await drugInfo({ query: pos[1] })) + "\n");
      return;
    }
    if (flags.http) {
      await startHttp(Number(opt("port") ?? process.env.PORT ?? 3000), opt("host") ?? process.env.HOST ?? "127.0.0.1");
      return;
    }
    const server = createServer();
    await server.connect(new StdioServerTransport());
    startRefresh();
    log("info", `leki-mcp ${VERSION} on stdio`);
  } catch (e) {
    process.stderr.write(`${e instanceof UserError ? "" : "Error: "}${(e as Error).message}\n`);
    process.exitCode = 1;
  }
}
void main();
