import type { HealthMonitor } from "../health/monitor.js";
import type { RecoveryOrchestrator } from "../recovery/orchestrator.js";
import type { BackupManager } from "../backup/manager.js";
import type { IncidentLogger } from "../incidents/logger.js";
import type { AlertDispatcher } from "../alerts/dispatcher.js";
import type { DeadManSwitch } from "../config-guardian/dead-man-switch.js";
import type { AegisConfig } from "../config/schema.js";
import { computeStatistics } from "../incidents/statistics.js";
import * as os from "node:os";

export interface BotDeps {
  config: AegisConfig;
  monitor: HealthMonitor;
  recovery?: RecoveryOrchestrator;
  backup?: BackupManager;
  incidents?: IncidentLogger;
  alerts?: AlertDispatcher;
  deadManSwitch?: DeadManSwitch;
  startedAt: number;
}

export interface CommandResult {
  text: string;
  markdown?: string;
}

type CommandFn = () => Promise<CommandResult> | CommandResult;

export class BotCommandHandler {
  private readonly commands: Map<string, { description: string; handler: CommandFn }> = new Map();

  constructor(private readonly deps: BotDeps) {
    this.register("health", "Health summary", this.cmdHealth.bind(this));
    this.register("status", "Per-probe details", this.cmdStatus.bind(this));
    this.register("incidents", "Recent incidents", this.cmdIncidents.bind(this));
    this.register("recovery", "Recovery & circuit breaker state", this.cmdRecovery.bind(this));
    this.register("backups", "Backup list", this.cmdBackups.bind(this));
    this.register("alerts", "Alert channel status", this.cmdAlerts.bind(this));
    this.register("version", "Version, uptime, platform", this.cmdVersion.bind(this));
    this.register("help", "List available commands", this.cmdHelp.bind(this));
  }

  private register(name: string, description: string, handler: CommandFn): void {
    this.commands.set(name, { description, handler });
  }

  async handle(input: string): Promise<CommandResult | null> {
    const cmd = input.trim().toLowerCase().replace(/^\//, "");
    const entry = this.commands.get(cmd);
    if (!entry) return null;
    return entry.handler();
  }

  getCommandList(): { name: string; description: string }[] {
    return Array.from(this.commands.entries()).map(([name, { description }]) => ({
      name,
      description,
    }));
  }

  // --- Commands ---

  private async cmdHealth(): Promise<CommandResult> {
    const score = this.deps.monitor.getLastScore() ?? (await this.deps.monitor.runAllProbes());
    const passed = score.probeResults.filter((p) => p.healthy).length;
    const failed = score.probeResults.filter((p) => !p.healthy);
    const icon =
      score.band === "healthy"
        ? "\u2705"
        : score.band === "degraded"
          ? "\u26A0\uFE0F"
          : "\u{1F6A8}";

    let text = `${icon} Health: ${score.band.toUpperCase()} (score: ${score.total})\nProbes: ${passed}/${score.probeResults.length} passed`;
    if (failed.length > 0) {
      text += "\n\nFailed:";
      for (const f of failed) {
        text += `\n  - ${f.name}: ${f.message ?? "failed"}`;
      }
    }
    return { text };
  }

  private async cmdStatus(): Promise<CommandResult> {
    const score = this.deps.monitor.getLastScore() ?? (await this.deps.monitor.runAllProbes());
    const icon =
      score.band === "healthy"
        ? "\u2705"
        : score.band === "degraded"
          ? "\u26A0\uFE0F"
          : "\u{1F6A8}";

    let text = `${icon} Health: ${score.band.toUpperCase()} (score: ${score.total})\n`;
    for (const p of score.probeResults) {
      const mark = p.healthy ? "+" : "-";
      const msg = p.message ? ` \u2014 ${p.message}` : "";
      text += `\n  ${mark} ${p.name} (${p.latencyMs}ms)${msg}`;
    }
    return { text };
  }

  private cmdIncidents(): CommandResult {
    if (!this.deps.incidents) {
      return { text: "No incident logger available." };
    }

    const ids = this.deps.incidents.getIncidents();
    if (ids.length === 0) {
      return { text: "\u2705 No incidents recorded." };
    }

    const stats = computeStatistics(this.deps.incidents);
    let text = `${ids.length} incident(s) \u2014 ${stats.resolvedIncidents} resolved, ${ids.length - stats.resolvedIncidents} unresolved`;

    if (stats.averageMttrMs > 0) {
      text += `\nAvg MTTR: ${(stats.averageMttrMs / 1000).toFixed(1)}s`;
    }

    // Show last 5
    const recent = ids.slice(-5);
    text += "\n\nRecent:";
    for (const id of recent) {
      const events = this.deps.incidents.getIncidentEvents(id);
      const start = events[0];
      const end = events.find(
        (e) => e.type === "INCIDENT_RESOLVED" || e.type === "INCIDENT_UNRESOLVED",
      );
      const resolved = end?.type === "INCIDENT_RESOLVED";
      const mark = resolved ? "+" : end ? "-" : "~";
      const startStr = start ? new Date(start.timestamp).toLocaleString() : "unknown";
      text += `\n  ${mark} ${id.slice(0, 8)} ${startStr} (${events.length} events)`;
    }
    return { text };
  }

  private cmdRecovery(): CommandResult {
    if (!this.deps.recovery) {
      return { text: "Recovery: idle (orchestrator not active)" };
    }

    const recovering = this.deps.recovery.isRecovering();
    const cb = this.deps.recovery.getCircuitBreaker();
    const tripped = cb.isTripped();

    let text = recovering ? "\u{1F527} Recovery: ACTIVE" : "\u2705 Recovery: idle";

    text += `\n\nCircuit breaker: ${tripped ? "\u{1F6A8} TRIPPED" : "OK"}`;
    text += `\nFailed cycles: ${cb.getFailedCycleCount()}/${this.deps.config.recovery.circuitBreakerMaxCycles}`;
    text += `\nWindow: ${(this.deps.config.recovery.circuitBreakerWindowMs / 60000).toFixed(0)} min`;

    if (this.deps.deadManSwitch) {
      const state = this.deps.deadManSwitch.getState();
      text += `\n\nDead man's switch: ${state}`;
    }

    return { text };
  }

  private cmdBackups(): CommandResult {
    if (!this.deps.backup) {
      return { text: "Backup manager not available." };
    }

    const chrono = this.deps.backup.getChronologicalBackups();
    const knownGood = this.deps.backup.getKnownGoodEntries();

    let text = `Backups: ${chrono.length} chronological, ${knownGood.length} known-good`;

    if (knownGood.length > 0) {
      const latest = knownGood[knownGood.length - 1];
      if (latest) {
        text += `\n\nLatest known-good: ${new Date(latest.promotedAt).toLocaleString()}`;
        text += `\nChecksum: ${latest.checksum.slice(0, 12)}...`;
      }
    }
    return { text };
  }

  private cmdAlerts(): CommandResult {
    const channels = this.deps.config.alerts.channels;
    if (channels.length === 0) {
      return { text: "No alert channels configured. Run 'aegis init' to add one." };
    }

    let text = `${channels.length} alert channel(s):\n`;
    for (const ch of channels) {
      text += `\n  - ${ch.type}`;
    }
    return { text };
  }

  private cmdVersion(): CommandResult {
    const uptimeMs = Date.now() - this.deps.startedAt;
    const hours = Math.floor(uptimeMs / 3600000);
    const minutes = Math.floor((uptimeMs % 3600000) / 60000);

    let text = `OpenClaw Aegis`;
    text += `\nPlatform: ${this.deps.config.platform.type} (${os.platform()} ${os.arch()})`;
    text += `\nNode: ${process.version}`;
    text += `\nUptime: ${hours}h ${minutes}m`;
    text += `\nHost: ${os.hostname()}`;
    return { text };
  }

  private cmdHelp(): CommandResult {
    let text = "Aegis Bot Commands:\n";
    for (const [name, { description }] of this.commands) {
      text += `\n  /${name} \u2014 ${description}`;
    }
    return { text };
  }
}
