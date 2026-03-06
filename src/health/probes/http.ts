import * as http from "node:http";
import type { HealthProbeResult, ProbeTarget } from "../../types/index.js";

export async function httpHealthProbe(
  target: ProbeTarget,
  port: number,
  endpoint: string = "/health",
  timeoutMs: number = 5000,
): Promise<HealthProbeResult> {
  const start = Date.now();
  const host = target.type === "remote" ? target.host : "127.0.0.1";

  return new Promise<HealthProbeResult>((resolve) => {
    const req = http.get(
      {
        hostname: host,
        port,
        path: endpoint,
        timeout: timeoutMs,
      },
      (res) => {
        const statusCode = res.statusCode ?? 0;
        res.resume();

        if (statusCode >= 200 && statusCode < 300) {
          resolve({
            name: "http",
            healthy: true,
            score: 2,
            latencyMs: Date.now() - start,
          });
        } else {
          resolve({
            name: "http",
            healthy: false,
            score: 0,
            message: `HTTP health returned status ${statusCode}`,
            latencyMs: Date.now() - start,
          });
        }
      },
    );

    req.on("error", (err) => {
      resolve({
        name: "http",
        healthy: false,
        score: 0,
        message: `HTTP health probe failed: ${err.message}`,
        latencyMs: Date.now() - start,
      });
    });

    req.on("timeout", () => {
      req.destroy();
      resolve({
        name: "http",
        healthy: false,
        score: 0,
        message: `HTTP health probe timed out after ${timeoutMs}ms`,
        latencyMs: Date.now() - start,
      });
    });
  });
}
