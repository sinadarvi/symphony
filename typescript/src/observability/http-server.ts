import http, { type Server } from "node:http";
import type { OrchestratorState } from "../orchestrator/state.js";
import { snapshotState } from "../orchestrator/snapshot.js";

export function startHttpServer(state: OrchestratorState, port: number): Promise<Server> {
  const server = http.createServer((request, response) => {
    if (request.url === "/" || request.url === "/api/v1/state") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(snapshotState(state), null, 2));
      return;
    }
    response.statusCode = 404;
    response.end("not found");
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}
