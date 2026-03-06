import WebSocket from "ws";
import type { HealthProbeResult, ProbeTarget } from "../../types/index.js";

export async function websocketProbe(
  target: ProbeTarget,
  port: number,
  timeoutMs: number = 5000,
): Promise<HealthProbeResult> {
  const start = Date.now();
  const host = target.type === "remote" ? target.host : "127.0.0.1";
  const url = `ws://${host}:${port}`;

  return new Promise<HealthProbeResult>((resolve) => {
    let resolved = false;
    const finish = (result: HealthProbeResult) => {
      if (!resolved) {
        resolved = true;
        resolve(result);
      }
    };

    const timer = setTimeout(() => {
      ws.terminate();
      finish({
        name: "websocket",
        healthy: false,
        score: 0,
        message: `WebSocket handshake timed out after ${timeoutMs}ms`,
        latencyMs: Date.now() - start,
      });
    }, timeoutMs);

    const ws = new WebSocket(url, { handshakeTimeout: timeoutMs });

    ws.on("open", () => {
      clearTimeout(timer);
      ws.close();
      finish({
        name: "websocket",
        healthy: true,
        score: 2,
        latencyMs: Date.now() - start,
      });
    });

    ws.on("error", (err) => {
      clearTimeout(timer);
      ws.terminate();
      finish({
        name: "websocket",
        healthy: false,
        score: 0,
        message: `WebSocket probe failed: ${err.message}`,
        latencyMs: Date.now() - start,
      });
    });
  });
}
