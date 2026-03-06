import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as path from "node:path";
import type { HealthProbeResult, ProbeTarget } from "../../types/index.js";

const execFileAsync = promisify(execFile);

export async function diskProbe(
  _target: ProbeTarget,
  configPath: string,
  thresholdMb: number = 100,
): Promise<HealthProbeResult> {
  const start = Date.now();

  try {
    const dir = path.dirname(configPath);
    const { stdout } = await execFileAsync("df", ["-BM", "--output=avail", dir]);
    const lines = stdout.trim().split("\n");
    const lastLine = lines[lines.length - 1];
    if (!lastLine) {
      return {
        name: "disk",
        healthy: true,
        score: 1,
        message: "Could not parse df output",
        latencyMs: Date.now() - start,
      };
    }
    const availStr = lastLine.trim().replace("M", "");
    const availMb = parseInt(availStr, 10);

    if (isNaN(availMb)) {
      return {
        name: "disk",
        healthy: true,
        score: 1,
        message: "Could not parse disk space",
        latencyMs: Date.now() - start,
      };
    }

    const healthy = availMb >= thresholdMb;

    return {
      name: "disk",
      healthy,
      score: healthy ? 2 : 0,
      message: healthy
        ? undefined
        : `Only ${availMb}MB available (threshold: ${thresholdMb}MB)`,
      latencyMs: Date.now() - start,
    };
  } catch (err) {
    return {
      name: "disk",
      healthy: true,
      score: 1,
      message: `Disk probe fallback: ${err instanceof Error ? err.message : String(err)}`,
      latencyMs: Date.now() - start,
    };
  }
}
