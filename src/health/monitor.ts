import { EventEmitter } from "node:events";
import type { HealthProbeResult, HealthScore, ProbeTarget } from "../types/index.js";
import type { AegisConfig } from "../config/schema.js";
import { computeHealthScore, DegradedConfirmation } from "./scoring.js";
import { processProbe } from "./probes/process.js";
import { portProbe } from "./probes/port.js";
import { httpHealthProbe } from "./probes/http.js";
import { configProbe } from "./probes/config.js";
import { tunProbe } from "./probes/tun.js";
import { memoryProbe } from "./probes/memory.js";
import { cpuProbe } from "./probes/cpu.js";
import { diskProbe } from "./probes/disk.js";
import { logTailProbe } from "./probes/log-tail.js";
import { websocketProbe } from "./probes/websocket.js";
import { channelsProbe } from "./probes/channels.js";

export class HealthMonitor extends EventEmitter {
  private interval: NodeJS.Timeout | null = null;
  private readonly degradedConfirmation: DegradedConfirmation;
  private lastScore: HealthScore | null = null;

  constructor(private readonly config: AegisConfig) {
    super();
    this.degradedConfirmation = new DegradedConfirmation(
      config.monitoring.degradedConfirmationCount,
    );
  }

  async runAllProbes(): Promise<HealthScore> {
    const target: ProbeTarget = { type: "local" };
    const timeout = this.config.monitoring.probeTimeoutMs;

    const withTimeout = async (
      fn: () => Promise<HealthProbeResult>,
      name: string,
    ): Promise<HealthProbeResult> => {
      try {
        return await Promise.race([
          fn(),
          new Promise<HealthProbeResult>((resolve) =>
            setTimeout(
              () =>
                resolve({
                  name,
                  healthy: false,
                  score: 0,
                  message: `Probe timed out after ${timeout}ms`,
                  latencyMs: timeout,
                }),
              timeout,
            ),
          ),
        ]);
      } catch (err) {
        return {
          name,
          healthy: false,
          score: 0,
          message: `Probe error: ${err instanceof Error ? err.message : String(err)}`,
          latencyMs: 0,
        };
      }
    };

    const results = await Promise.allSettled([
      withTimeout(() => processProbe(target, this.config.gateway.pidFile), "process"),
      withTimeout(() => portProbe(target, this.config.gateway.port, timeout), "port"),
      withTimeout(
        () =>
          httpHealthProbe(
            target,
            this.config.gateway.port,
            this.config.gateway.healthEndpoint,
            timeout,
          ),
        "http",
      ),
      withTimeout(() => configProbe(target, this.config.gateway.configPath), "config"),
      withTimeout(() => tunProbe(target), "tun"),
      withTimeout(
        () =>
          memoryProbe(target, this.config.gateway.pidFile, this.config.health.memoryThresholdMb),
        "memory",
      ),
      withTimeout(
        () => cpuProbe(target, this.config.gateway.pidFile, this.config.health.cpuThresholdPercent),
        "cpu",
      ),
      withTimeout(
        () => diskProbe(target, this.config.gateway.configPath, this.config.health.diskThresholdMb),
        "disk",
      ),
      withTimeout(() => logTailProbe(target, this.config.gateway.logPath), "logTail"),
      withTimeout(() => websocketProbe(target, this.config.gateway.port, timeout), "websocket"),
      withTimeout(() => channelsProbe(target, timeout), "channels"),
    ]);

    const probeResults: HealthProbeResult[] = results.map((r, i) => {
      if (r.status === "fulfilled") return r.value;
      const names = [
        "process",
        "port",
        "http",
        "config",
        "tun",
        "memory",
        "cpu",
        "disk",
        "logTail",
        "websocket",
        "channels",
      ] as const;
      return {
        name: names[i] ?? "unknown",
        healthy: false,
        score: 0,
        message: `Probe rejected: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`,
        latencyMs: 0,
      };
    });

    const score = computeHealthScore(probeResults, {
      healthyMin: this.config.health.healthyMin,
      degradedMin: this.config.health.degradedMin,
    });

    this.lastScore = score;
    const shouldEscalate = this.degradedConfirmation.update(score.band);

    this.emit("check", score);

    if (shouldEscalate && score.band !== "healthy") {
      this.emit("escalate", score);
    }

    return score;
  }

  start(): void {
    this.interval = setInterval(() => {
      void this.runAllProbes();
    }, this.config.monitoring.intervalMs);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  getLastScore(): HealthScore | null {
    return this.lastScore;
  }
}
