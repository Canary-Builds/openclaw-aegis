import type { HealthProbeResult, ProbeTarget } from "../../types/index.js";
import { resolvePid } from "./resolve-pid.js";

export async function processProbe(
  _target: ProbeTarget,
  pidSource: string,
): Promise<HealthProbeResult> {
  const start = Date.now();
  try {
    const pid = resolvePid(pidSource);

    if (pid === null) {
      return {
        name: "process",
        healthy: false,
        score: 0,
        message: "Gateway process not found (checked systemd unit and PID file)",
        latencyMs: Date.now() - start,
      };
    }

    try {
      process.kill(pid, 0);
      return {
        name: "process",
        healthy: true,
        score: 2,
        latencyMs: Date.now() - start,
      };
    } catch {
      return {
        name: "process",
        healthy: false,
        score: 0,
        message: `Process ${pid} not running (stale PID)`,
        latencyMs: Date.now() - start,
      };
    }
  } catch (err) {
    return {
      name: "process",
      healthy: false,
      score: 0,
      message: `Process probe error: ${err instanceof Error ? err.message : String(err)}`,
      latencyMs: Date.now() - start,
    };
  }
}
