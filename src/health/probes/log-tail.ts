import * as fs from "node:fs";
import type { HealthProbeResult, ProbeTarget } from "../../types/index.js";

const ERROR_PATTERNS = [
  /ECONNRESET/,
  /SIGTERM/,
  /SIGKILL/,
  /ENOMEM/,
  /fatal\s+error/i,
  /uncaught\s+exception/i,
  /unhandled\s+rejection/i,
  /out\s+of\s+memory/i,
  /EACCES/,
  /ENOSPC/,
];

export async function logTailProbe(
  _target: ProbeTarget,
  logPath: string,
  tailLines: number = 50,
): Promise<HealthProbeResult> {
  const start = Date.now();

  try {
    if (!fs.existsSync(logPath)) {
      return {
        name: "logTail",
        healthy: true,
        score: 2,
        message: "Log file not found (may not exist yet)",
        latencyMs: Date.now() - start,
      };
    }

    const content = fs.readFileSync(logPath, "utf-8");
    const lines = content.split("\n").slice(-tailLines);
    const recentText = lines.join("\n");

    const matchedPatterns = ERROR_PATTERNS.filter((p) => p.test(recentText));

    if (matchedPatterns.length === 0) {
      return {
        name: "logTail",
        healthy: true,
        score: 2,
        latencyMs: Date.now() - start,
      };
    }

    const score = matchedPatterns.length >= 3 ? 0 : 1;

    return {
      name: "logTail",
      healthy: false,
      score,
      message: `Error patterns in recent logs: ${matchedPatterns.map((p) => p.source).join(", ")}`,
      latencyMs: Date.now() - start,
    };
  } catch (err) {
    return {
      name: "logTail",
      healthy: true,
      score: 1,
      message: `Log tail probe fallback: ${err instanceof Error ? err.message : String(err)}`,
      latencyMs: Date.now() - start,
    };
  }
}
