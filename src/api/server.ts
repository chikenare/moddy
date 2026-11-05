import type { Server } from "node:http";
import { type ServerType, serve } from "@hono/node-server";

type Fetch = Parameters<typeof serve>[0]["fetch"];

// Holding many slow requests open must not run the bot out of memory: a crash would stop moderation too.
export function startApiServer(fetch: Fetch, port: number): Server {
  const server: ServerType = serve({ fetch, port, serverOptions: { requestTimeout: 30_000 } });
  server.maxConnections = 256;
  return server as Server;
}
