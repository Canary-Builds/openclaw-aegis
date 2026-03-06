import * as fs from "node:fs";
import type { HealthProbeResult, ProbeTarget } from "../../types/index.js";
import { resolvePid } from "./resolve-pid.js";

export async function cpuProbe(
  _target: ProbeTarget,
  pidSource: string,
  thresholdPercent: number = 90,
  sampleMs: number = 1000,
): Promise<HealthProbeResult> {
  const start = Date.now();

  try {
    const pid = resolvePid(pidSource);

    if (pid === null) {
      return {
        name: "cpu",
        healthy: false,
        score: 0,
        message: "Gateway process not found — cannot check CPU",
        latencyMs: Date.now() - start,
      };
    }

    const statPath = `/proc/${pid}/stat`;

    if (!fs.existsSync(statPath)) {
      return {
        name: "cpu",
        healthy: false,
        score: 0,
        message: `Process ${pid} not found in /proc`,
        latencyMs: Date.now() - start,
      };
    }

    const readCpuTime = (): number => {
      const stat = fs.readFileSync(statPath, "utf-8");
      const fields = stat.split(" ");
      const utime = parseInt(fields[13] ?? "0", 10) || 0;
      const stime = parseInt(fields[14] ?? "0", 10) || 0;
      return utime + stime;
    };

    const cpuTime1 = readCpuTime();
    await new Promise((r) => setTimeout(r, sampleMs));
    const cpuTime2 = readCpuTime();

    const clockTicks = 100; // sysconf(_SC_CLK_TCK) — typically 100 on Linux
    const cpuDelta = (cpuTime2 - cpuTime1) / clockTicks;
    const cpuPercent = (cpuDelta / (sampleMs / 1000)) * 100;
    const healthy = cpuPercent < thresholdPercent;

    return {
      name: "cpu",
      healthy,
      score: healthy ? 2 : 0,
      message: healthy
        ? undefined
        : `CPU ${cpuPercent.toFixed(1)}% exceeds threshold ${thresholdPercent}%`,
      latencyMs: Date.now() - start,
    };
  } catch (err) {
    return {
      name: "cpu",
      healthy: false,
      score: 0,
      message: `CPU probe error: ${err instanceof Error ? err.message : String(err)}`,
      latencyMs: Date.now() - start,
    };
  }
}
