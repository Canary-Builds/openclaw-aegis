import * as fs from "node:fs";
import type { HealthProbeResult, ProbeTarget } from "../../types/index.js";
import { resolvePid } from "./resolve-pid.js";

export async function memoryProbe(
  _target: ProbeTarget,
  pidSource: string,
  thresholdMb: number = 512,
): Promise<HealthProbeResult> {
  const start = Date.now();

  try {
    const pid = resolvePid(pidSource);

    if (pid === null) {
      return {
        name: "memory",
        healthy: false,
        score: 0,
        message: "Gateway process not found — cannot check memory",
        latencyMs: Date.now() - start,
      };
    }

    const statusPath = `/proc/${pid}/status`;

    if (!fs.existsSync(statusPath)) {
      return {
        name: "memory",
        healthy: false,
        score: 0,
        message: `Process ${pid} not found in /proc`,
        latencyMs: Date.now() - start,
      };
    }

    const status = fs.readFileSync(statusPath, "utf-8");
    const rssMatch = status.match(/VmRSS:\s+(\d+)\s+kB/);

    if (!rssMatch) {
      return {
        name: "memory",
        healthy: true,
        score: 1,
        message: "Could not parse RSS from /proc status",
        latencyMs: Date.now() - start,
      };
    }

    const rssKb = parseInt(rssMatch[1] ?? "0", 10);
    const rssMb = rssKb / 1024;
    const healthy = rssMb < thresholdMb;

    return {
      name: "memory",
      healthy,
      score: healthy ? 2 : 0,
      message: healthy ? undefined : `RSS ${rssMb.toFixed(0)}MB exceeds threshold ${thresholdMb}MB`,
      latencyMs: Date.now() - start,
    };
  } catch (err) {
    return {
      name: "memory",
      healthy: false,
      score: 0,
      message: `Memory probe error: ${err instanceof Error ? err.message : String(err)}`,
      latencyMs: Date.now() - start,
    };
  }
}
