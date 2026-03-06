import * as fs from "node:fs";
import * as os from "node:os";
import { execSync } from "node:child_process";
import type { HealthProbeResult, ProbeTarget } from "../../types/index.js";
import { resolvePid } from "./resolve-pid.js";

function getRssMb(pid: number): number | null {
  if (os.platform() !== "darwin") {
    // Linux: read from /proc
    const statusPath = `/proc/${pid}/status`;
    if (!fs.existsSync(statusPath)) return null;
    const status = fs.readFileSync(statusPath, "utf-8");
    const rssMatch = status.match(/VmRSS:\s+(\d+)\s+kB/);
    if (!rssMatch) return null;
    return parseInt(rssMatch[1] ?? "0", 10) / 1024;
  }

  // macOS: use ps
  try {
    const output = execSync(`ps -o rss= -p ${pid}`, { encoding: "utf-8" }).trim();
    const rssKb = parseInt(output, 10);
    if (isNaN(rssKb)) return null;
    return rssKb / 1024;
  } catch {
    return null;
  }
}

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

    const rssMb = getRssMb(pid);

    if (rssMb === null) {
      return {
        name: "memory",
        healthy: false,
        score: 0,
        message: `Could not read memory for process ${pid}`,
        latencyMs: Date.now() - start,
      };
    }
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
