import * as fs from "node:fs";
import type { HealthProbeResult, ProbeTarget } from "../../types/index.js";

const REQUIRED_CONFIG_PATHS: { path: string[]; label: string }[] = [
  { path: ["gateway", "port"], label: "gateway.port" },
];

const POISON_KEYS = ["autoAck", "autoAckMessage"];

export async function configProbe(
  _target: ProbeTarget,
  configPath: string,
): Promise<HealthProbeResult> {
  const start = Date.now();

  try {
    if (!fs.existsSync(configPath)) {
      return {
        name: "config",
        healthy: false,
        score: 0,
        message: "Gateway config file not found",
        latencyMs: Date.now() - start,
      };
    }

    const raw = fs.readFileSync(configPath, "utf-8");
    let parsed: Record<string, unknown>;

    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {
        name: "config",
        healthy: false,
        score: 0,
        message: "Gateway config is not valid JSON",
        latencyMs: Date.now() - start,
      };
    }

    const missingPaths = REQUIRED_CONFIG_PATHS.filter(({ path }) => {
      let obj: unknown = parsed;
      for (const key of path) {
        if (obj === null || typeof obj !== "object" || !(key in obj)) return true;
        obj = (obj as Record<string, unknown>)[key];
      }
      return false;
    });
    if (missingPaths.length > 0) {
      return {
        name: "config",
        healthy: false,
        score: 0,
        message: `Missing required config keys: ${missingPaths.map((p) => p.label).join(", ")}`,
        latencyMs: Date.now() - start,
      };
    }

    const foundPoison = POISON_KEYS.filter((key) => key in parsed);
    if (foundPoison.length > 0) {
      return {
        name: "config",
        healthy: false,
        score: 0,
        message: `Poison keys detected: ${foundPoison.join(", ")}`,
        latencyMs: Date.now() - start,
      };
    }

    return {
      name: "config",
      healthy: true,
      score: 2,
      latencyMs: Date.now() - start,
    };
  } catch (err) {
    return {
      name: "config",
      healthy: false,
      score: 0,
      message: `Config probe error: ${err instanceof Error ? err.message : String(err)}`,
      latencyMs: Date.now() - start,
    };
  }
}
