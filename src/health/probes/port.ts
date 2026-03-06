import * as net from "node:net";
import type { HealthProbeResult, ProbeTarget } from "../../types/index.js";

export async function portProbe(
  target: ProbeTarget,
  port: number,
  timeoutMs: number = 5000,
): Promise<HealthProbeResult> {
  const start = Date.now();
  const host = target.type === "remote" ? target.host : "127.0.0.1";

  return new Promise<HealthProbeResult>((resolve) => {
    const socket = new net.Socket();
    let resolved = false;

    const finish = (result: HealthProbeResult) => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
        resolve(result);
      }
    };

    socket.setTimeout(timeoutMs);

    socket.connect(port, host, () => {
      finish({
        name: "port",
        healthy: true,
        score: 2,
        latencyMs: Date.now() - start,
      });
    });

    socket.on("error", (err) => {
      finish({
        name: "port",
        healthy: false,
        score: 0,
        message: `Port ${port} unreachable: ${err.message}`,
        latencyMs: Date.now() - start,
      });
    });

    socket.on("timeout", () => {
      finish({
        name: "port",
        healthy: false,
        score: 0,
        message: `Port ${port} connection timed out after ${timeoutMs}ms`,
        latencyMs: Date.now() - start,
      });
    });
  });
}
